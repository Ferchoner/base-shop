import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import { toId } from '../../../shared-kernel/index.js';
import type { RefreshTokenRecord, SessionId } from '../domain/session.js';
import {
  type NewRefreshToken,
  SessionRepository,
} from '../domain/session.repository.js';
import type { UserId } from '../domain/user.js';

interface RefreshTokenRow {
  id: string;
  userId: string;
  sessionId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedById: string | null;
}

/** `refresh_tokens` (DATABASE.md §3.6), always through the active transaction. */
@Injectable()
export class PrismaSessionRepository extends SessionRepository {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  async add(token: NewRefreshToken): Promise<void> {
    await this.txHost.tx.refreshToken.create({ data: token });
  }

  async findByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    const row = await this.txHost.tx.refreshToken.findUnique({
      where: { tokenHash },
    });
    return row === null ? null : toRecord(row);
  }

  async findByHashForUpdate(
    tokenHash: string,
  ): Promise<RefreshTokenRecord | null> {
    const [row] = await this.txHost.tx.$queryRaw<RefreshTokenRow[]>`
      SELECT id, user_id AS "userId", session_id AS "sessionId", token_hash AS "tokenHash",
             expires_at AS "expiresAt", revoked_at AS "revokedAt", replaced_by_id AS "replacedById"
      FROM refresh_tokens WHERE token_hash = ${tokenHash} FOR UPDATE`;
    return row === undefined ? null : toRecord(row);
  }

  async rotate(
    token: RefreshTokenRecord,
    next: NewRefreshToken,
    at: Date,
  ): Promise<void> {
    const tx = this.txHost.tx;
    await tx.refreshToken.create({ data: next });
    await tx.refreshToken.update({
      where: { id: token.id },
      data: { revokedAt: at, replacedById: next.id },
    });
  }

  async revokeSession(sessionId: SessionId, at: Date): Promise<number> {
    const { count } = await this.txHost.tx.refreshToken.updateMany({
      where: { sessionId, revokedAt: null },
      data: { revokedAt: at },
    });
    return count;
  }

  async revokeAllOf(userId: UserId, at: Date): Promise<void> {
    await this.txHost.tx.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: at },
    });
  }

  async isActive(
    sessionId: SessionId,
    userId: UserId,
    now: Date,
  ): Promise<boolean> {
    const usable = await this.txHost.tx.refreshToken.findFirst({
      select: { id: true },
      where: { sessionId, userId, revokedAt: null, expiresAt: { gt: now } },
    });
    return usable !== null;
  }
}

function toRecord(row: RefreshTokenRow): RefreshTokenRecord {
  return {
    id: toId<'RefreshToken'>(row.id),
    userId: toId<'User'>(row.userId),
    sessionId: toId<'Session'>(row.sessionId),
    tokenHash: row.tokenHash,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    replacedById:
      row.replacedById === null ? null : toId<'RefreshToken'>(row.replacedById),
  };
}
