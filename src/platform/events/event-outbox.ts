import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { type DomainEvent, newId } from '../../shared-kernel/index.js';
import type { Prisma } from '../persistence/prisma/generated/client.js';
import { PrismaService } from '../persistence/prisma.service.js';
import type { PrismaTransactionAdapter } from '../persistence/transactional-plugin.js';
import { fromPayload, toPayload } from './event-payload.js';
import {
  DELIVERY_LEASE_MS,
  MAX_DELIVERY_ATTEMPTS,
  nextAttemptAt,
} from './event-retries.js';

/** A delivery someone took: the attempt it counts and the event to hand to its handler. */
export interface ClaimedDelivery {
  readonly id: string;
  readonly handler: string;
  readonly attempts: number;
  readonly event: DomainEvent;
}

/** The models the outbox writes when it stores events, in the active transaction or in one of its own. */
type OutboxClient = Pick<
  Prisma.TransactionClient,
  'storedDomainEvent' | 'eventDelivery'
>;

/** Events to store, each with the handlers that get a delivery. */
export type EventsToStore = readonly {
  readonly event: DomainEvent;
  readonly handlers: readonly string[];
}[];

/** What a failed attempt left: retried at `retryAt`, or failed for good when it is `null`. */
export interface FailedAttempt {
  readonly retryAt: Date | null;
}

interface ClaimRow {
  id: string;
  handler: string;
  attempts: number;
  payload: unknown;
  occurred_at: Date;
}

/**
 * The outbox of domain events (DATABASE.md §11.4, ADR-0150): `domain_events` and one row of `event_deliveries` per
 * handler. Events are stored in the active transaction; deliveries are taken and settled outside any, with
 * PrismaService, so taking one commits before its handler runs.
 */
@Injectable()
export class EventOutbox {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Stores the events in the active transaction, with a pending delivery for each of their handlers; an event without
   * handlers is not kept.
   */
  save(events: EventsToStore, now: Date): Promise<void> {
    return this.write(this.txHost.tx, events, now);
  }

  /** Stores the events as `save` does, in a transaction of their own: for events published outside one. */
  async saveAlone(events: EventsToStore, now: Date): Promise<void> {
    await this.prisma.$transaction((tx) => this.write(tx, events, now));
  }

  private async write(
    client: OutboxClient,
    events: EventsToStore,
    now: Date,
  ): Promise<void> {
    const handled = events.filter(({ handlers }) => handlers.length > 0);
    if (handled.length === 0) return;
    const firstRetry = nextAttemptAt(0, now) as Date;
    await client.storedDomainEvent.createMany({
      data: handled.map(({ event }) => ({
        id: event.eventId,
        eventType: event.eventType,
        payload: toPayload(event) as Prisma.InputJsonObject,
        occurredAt: event.occurredAt,
      })),
    });
    await client.eventDelivery.createMany({
      data: handled.flatMap(({ event, handlers }) =>
        handlers.map((handler) => ({
          id: newId(),
          eventId: event.eventId,
          handler,
          status: 'PENDING' as const,
          nextAttemptAt: firstRetry,
        })),
      ),
    });
  }

  /**
   * Takes the pending delivery of the event to `handler`, unless someone else holds it, and counts one more attempt.
   * Answers it, or `null` when it was taken, settled or is not there.
   */
  async claim(
    eventId: string,
    handler: string,
    now: Date,
  ): Promise<{ readonly id: string; readonly attempts: number } | null> {
    const [row] = await this.prisma.$queryRaw<
      { id: string; attempts: number }[]
    >`
      UPDATE event_deliveries
         SET attempts = attempts + 1, locked_until = ${new Date(now.getTime() + DELIVERY_LEASE_MS)}
       WHERE event_id = ${eventId}::uuid AND handler = ${handler}
         AND status = 'PENDING' AND attempts < ${MAX_DELIVERY_ATTEMPTS}
         AND (locked_until IS NULL OR locked_until <= ${now})
      RETURNING id, attempts`;
    return row ?? null;
  }

  /**
   * Takes up to `limit` deliveries due by `now` that nobody holds, each by one taker only, also with several
   * instances (`FOR UPDATE SKIP LOCKED`), and counts one more attempt of each. Answers them oldest event first.
   */
  async claimDue(now: Date, limit: number): Promise<ClaimedDelivery[]> {
    const rows = await this.prisma.$queryRaw<ClaimRow[]>`
      UPDATE event_deliveries AS d
         SET attempts = d.attempts + 1, locked_until = ${new Date(now.getTime() + DELIVERY_LEASE_MS)}
        FROM domain_events AS e
       WHERE e.id = d.event_id
         AND d.id IN (SELECT id FROM event_deliveries
                       WHERE status = 'PENDING' AND next_attempt_at <= ${now}
                         AND attempts < ${MAX_DELIVERY_ATTEMPTS}
                         AND (locked_until IS NULL OR locked_until <= ${now})
                       ORDER BY next_attempt_at, id
                       LIMIT ${limit}
                       FOR UPDATE SKIP LOCKED)
      RETURNING d.id, d.handler, d.attempts, e.payload, e.occurred_at`;
    return rows
      .sort(
        (a, b) =>
          a.occurred_at.getTime() - b.occurred_at.getTime() ||
          a.id.localeCompare(b.id),
      )
      .map((row) => ({
        id: row.id,
        handler: row.handler,
        attempts: row.attempts,
        event: fromPayload(row.payload),
      }));
  }

  async markDelivered(id: string, now: Date): Promise<void> {
    await this.prisma.eventDelivery.update({
      where: { id },
      data: {
        status: 'DELIVERED',
        deliveredAt: now,
        lockedUntil: null,
        lastError: null,
      },
    });
  }

  /** Records a failed attempt: retried later while attempts are left, failed for good after the last one. */
  async markFailedAttempt(
    id: string,
    attempts: number,
    now: Date,
    error: string,
  ): Promise<FailedAttempt> {
    const retryAt = nextAttemptAt(attempts, now);
    await this.prisma.eventDelivery.update({
      where: { id },
      data:
        retryAt === null
          ? { status: 'FAILED', lockedUntil: null, lastError: error }
          : { nextAttemptAt: retryAt, lockedUntil: null, lastError: error },
    });
    return { retryAt };
  }

  /** Fails the deliveries whose last attempt never finished: no attempts left, and the lease ran out. */
  failAbandoned(now: Date): Promise<number> {
    return this.prisma.$executeRaw`
      UPDATE event_deliveries
         SET status = 'FAILED', locked_until = NULL, last_error = 'The last attempt did not finish'
       WHERE status = 'PENDING' AND attempts >= ${MAX_DELIVERY_ATTEMPTS} AND locked_until <= ${now}`;
  }
}
