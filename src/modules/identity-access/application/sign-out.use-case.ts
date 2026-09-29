import { Injectable } from '@nestjs/common';
import {
  AuditTrail,
  Clock,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import { SessionRepository } from '../domain/session.repository.js';
import type { UserId } from '../domain/user.js';
import { hashRefreshToken } from './session-tokens.js';

/**
 * Signs out (UC-IAM-06): revokes the session of the refresh token when it belongs to the signed-in user, and
 * audits it. Otherwise, or when it was already revoked, nothing changes and the answer is the same, so it is
 * idempotent and does not reveal other users' sessions (API_SPEC.md §9.7). The session's access tokens stop
 * working at once (ADR-0114).
 */
@Injectable()
export class SignOut {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  execute(input: { userId: UserId; refreshToken: string }): Promise<void> {
    return this.transactions.run(async () => {
      const token = await this.sessions.findByHash(
        hashRefreshToken(input.refreshToken),
      );
      if (token === null || token.userId !== input.userId) return;
      const revoked = await this.sessions.revokeSession(
        token.sessionId,
        this.clock.now(),
      );
      if (revoked === 0) return;
      await this.audit.record({
        action: 'auth.logout',
        resource: { type: 'user', id: input.userId },
      });
    });
  }
}
