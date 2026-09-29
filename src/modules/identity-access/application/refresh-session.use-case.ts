import { Injectable } from '@nestjs/common';
import {
  AuditTrail,
  Clock,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import { refreshTokenState } from '../domain/session.js';
import { SessionRepository } from '../domain/session.repository.js';
import type { UserId } from '../domain/user.js';
import { UserRepository } from '../domain/user.repository.js';
import {
  hashRefreshToken,
  type IssuedTokens,
  SessionTokens,
} from './session-tokens.js';

export type RefreshSessionResult =
  | {
      readonly outcome: 'RENEWED';
      readonly userId: UserId;
      readonly mustChangePassword: boolean;
      readonly tokens: IssuedTokens;
    }
  | { readonly outcome: 'INVALID' };

const INVALID: RefreshSessionResult = { outcome: 'INVALID' };

/**
 * Renews a session with its refresh token (UC-IAM-05, ADR-0023): the token is rotated into a new one of the
 * same session. An unknown, expired or revoked token, or one of an account that can no longer sign in, is
 * invalid. Presenting a token that was already rotated means someone else has a copy: the whole session is
 * revoked and the reuse audited, and that is committed even though the answer is a failure.
 */
@Injectable()
export class RefreshSession {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly tokens: SessionTokens,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  execute(input: { refreshToken: string }): Promise<RefreshSessionResult> {
    return this.transactions.run(async () => {
      const token = await this.sessions.findByHashForUpdate(
        hashRefreshToken(input.refreshToken),
      );
      if (token === null) return INVALID;
      const now = this.clock.now();
      const state = refreshTokenState(token, now);
      if (state === 'rotated') {
        await this.sessions.revokeSession(token.sessionId, now);
        await this.audit.record({
          action: 'auth.refresh-token-reuse',
          result: 'DENIED',
          actor: { type: 'ANONYMOUS' },
          resource: { type: 'user', id: token.userId },
        });
        return INVALID;
      }
      if (state !== 'usable') return INVALID;
      const user = await this.users.findById(token.userId);
      if (user === null || !user.canSignIn) return INVALID;

      const next = this.tokens.newRefreshToken(user.id, token.sessionId, now);
      await this.sessions.rotate(token, next.record, now);
      return {
        outcome: 'RENEWED',
        userId: user.id,
        mustChangePassword: user.mustChangePassword,
        tokens: this.tokens.pair(user.id, token.sessionId, next.token),
      };
    });
  }
}
