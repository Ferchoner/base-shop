import { Injectable } from '@nestjs/common';
import { Prisma } from '../../persistence/prisma/generated/client.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import type { IdempotencyScope } from './idempotency-scope.js';

/** How long a response is kept (ADR-0063). */
const RETENTION_MS = 24 * 60 * 60 * 1000;
/** A request still in progress after this long is taken as abandoned, for example by a crash (ADR-0099). */
export const ABANDONED_AFTER_MS = 60 * 1000;

/** One use of an idempotency key. `startedAt` tells this attempt apart from a later takeover. */
export interface IdempotencyAttempt {
  readonly scope: IdempotencyScope;
  readonly endpoint: string;
  readonly key: string;
  readonly requestHash: string;
  readonly startedAt: Date;
}

/** A response kept for replay: a success, or a business error as its problem type and extensions. */
export type StoredResponse =
  | {
      readonly kind: 'success';
      readonly status: number;
      readonly body: unknown;
      readonly location?: string;
    }
  | {
      readonly kind: 'problem';
      readonly code: string;
      readonly extensions: Record<string, unknown>;
    };

export type BeginOutcome =
  | { readonly kind: 'started' }
  | { readonly kind: 'replay'; readonly response: StoredResponse }
  | { readonly kind: 'mismatch' }
  | { readonly kind: 'in-progress' };

interface KeyRow {
  request_hash: string;
  status: 'IN_PROGRESS' | 'COMPLETED';
  response_body: StoredResponse | null;
}

/**
 * The `idempotency_keys` table (ADR-0063, ADR-0099). It works outside any use case transaction on purpose:
 * the key is claimed before the operation and completed after it.
 */
@Injectable()
export class IdempotencyStore {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Claims the key, atomically. A new key, an expired one, or one abandoned with the same content is taken
   * by this attempt; otherwise the outcome says what the existing key allows.
   */
  async begin(attempt: IdempotencyAttempt): Promise<BeginOutcome> {
    // A key can vanish between the claim and the read, when the other request fails; then claim again.
    for (let tries = 0; tries < 3; tries++) {
      if (await this.claim(attempt)) return { kind: 'started' };
      const existing = await this.find(attempt);
      if (existing === undefined) continue;
      if (existing.request_hash !== attempt.requestHash) {
        return { kind: 'mismatch' };
      }
      if (existing.status === 'IN_PROGRESS' || !existing.response_body) {
        return { kind: 'in-progress' };
      }
      return { kind: 'replay', response: existing.response_body };
    }
    return { kind: 'in-progress' };
  }

  /** Keeps the response of an attempt that ran; ignored if another attempt took the key over. */
  async complete(
    attempt: IdempotencyAttempt,
    response: StoredResponse,
  ): Promise<void> {
    const status = response.kind === 'success' ? response.status : null;
    await this.prisma.$executeRaw`
      UPDATE idempotency_keys
         SET status = 'COMPLETED'::idempotency_status,
             response_status = ${status},
             response_body = ${JSON.stringify(response)}::jsonb
       WHERE ${this.matchesAttempt(attempt)}`;
  }

  /**
   * Deletes at most `limit` keys expired by `now`, in one statement (ADR-0144), and answers how many. The `DELETE`
   * checks the expiry again, so a key claimed again meanwhile, which got a new expiry, stays.
   */
  deleteExpired(now: Date, limit: number): Promise<number> {
    return this.prisma.$executeRaw`
      DELETE FROM idempotency_keys
       WHERE (scope_type, scope_id, endpoint, key) IN (
             SELECT scope_type, scope_id, endpoint, key FROM idempotency_keys
              WHERE expires_at <= ${now}
              LIMIT ${limit})
         AND expires_at <= ${now}`;
  }

  /**
   * Deletes the responses kept for these scopes, which can repeat the data of a buyer being anonymized (ADR-0145),
   * and answers how many. A key still in progress stays: it keeps no response yet.
   */
  async forget(scopes: readonly IdempotencyScope[]): Promise<number> {
    if (scopes.length === 0) return 0;
    const { count } = await this.prisma.idempotencyKey.deleteMany({
      where: {
        status: 'COMPLETED',
        OR: scopes.map(({ type, id }) => ({ scopeType: type, scopeId: id })),
      },
    });
    return count;
  }

  /**
   * Deletes the responses an endpoint kept of these resources, by the `id` of the body it answered, wherever their
   * scope (ADR-0161): the staff places orders in its own scope, together with other responses that must stay. A key
   * still in progress stays, as in `forget`.
   */
  async forgetResponsesOf(
    endpoint: string,
    resourceIds: readonly string[],
  ): Promise<number> {
    if (resourceIds.length === 0) return 0;
    return this.prisma.$executeRaw`
      DELETE FROM idempotency_keys
       WHERE status = 'COMPLETED'
         AND endpoint = ${endpoint}
         AND response_body -> 'body' ->> 'id' = ANY(${[...resourceIds]}::text[])`;
  }

  /** Frees the key of an attempt whose result is not kept, so the client can retry with it. */
  async release(attempt: IdempotencyAttempt): Promise<void> {
    await this.prisma.$executeRaw`
      DELETE FROM idempotency_keys WHERE ${this.matchesAttempt(attempt)}`;
  }

  private async claim(attempt: IdempotencyAttempt): Promise<boolean> {
    const { scope, endpoint, key, requestHash, startedAt } = attempt;
    const expiresAt = new Date(startedAt.getTime() + RETENTION_MS);
    const abandonedBefore = new Date(startedAt.getTime() - ABANDONED_AFTER_MS);
    const claimed = await this.prisma.$queryRaw<unknown[]>`
      INSERT INTO idempotency_keys
        (scope_type, scope_id, endpoint, key, request_hash, status, created_at, expires_at)
      VALUES
        (${scope.type}::idempotency_scope, ${scope.id}::uuid, ${endpoint}, ${key}, ${requestHash},
         'IN_PROGRESS'::idempotency_status, ${startedAt}, ${expiresAt})
      ON CONFLICT (scope_type, scope_id, endpoint, key) DO UPDATE
         SET request_hash = EXCLUDED.request_hash,
             status = EXCLUDED.status,
             response_status = NULL,
             response_body = NULL,
             created_at = EXCLUDED.created_at,
             expires_at = EXCLUDED.expires_at
       WHERE idempotency_keys.expires_at <= ${startedAt}
          OR (idempotency_keys.status = 'IN_PROGRESS'::idempotency_status
              AND idempotency_keys.created_at <= ${abandonedBefore}
              AND idempotency_keys.request_hash = EXCLUDED.request_hash)
      RETURNING 1`;
    return claimed.length === 1;
  }

  private async find(attempt: IdempotencyAttempt): Promise<KeyRow | undefined> {
    const rows = await this.prisma.$queryRaw<KeyRow[]>`
      SELECT request_hash, status, response_body
        FROM idempotency_keys
       WHERE ${this.matchesKey(attempt)}`;
    return rows[0];
  }

  private matchesKey({ scope, endpoint, key }: IdempotencyAttempt): Prisma.Sql {
    return Prisma.sql`scope_type = ${scope.type}::idempotency_scope
      AND scope_id = ${scope.id}::uuid AND endpoint = ${endpoint} AND key = ${key}`;
  }

  private matchesAttempt(attempt: IdempotencyAttempt): Prisma.Sql {
    return Prisma.sql`${this.matchesKey(attempt)}
      AND status = 'IN_PROGRESS'::idempotency_status
      AND request_hash = ${attempt.requestHash} AND created_at = ${attempt.startedAt}`;
  }
}
