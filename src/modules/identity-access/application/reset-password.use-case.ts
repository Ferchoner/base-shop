import { Injectable } from '@nestjs/common';
import {
  AuditTrail,
  changesBetween,
  Clock,
  hashLinkToken,
  InvalidOrExpiredTokenError,
  isUsableLink,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import { PasswordResetTokenRepository } from '../domain/password-reset.js';
import { SessionRepository } from '../domain/session.repository.js';
import { UserRepository } from '../domain/user.repository.js';
import { PasswordChangeNotice } from './password-change-notice.js';
import { PasswordHasher } from './password-hasher.js';
import { PasswordPolicy } from './password-policy.js';

/**
 * Sets a new password with the token of a recovery link (UC-IAM-08, BR-USR-16): once, within its lifetime,
 * for an account that can sign in; otherwise 400 `invalid-or-expired-token`. The new password follows the
 * policy; if it does not, the link stays usable. Every session is revoked, the change is audited, and the
 * owner is told by email after the commit (ADR-0056, ADR-0118).
 */
@Injectable()
export class ResetPassword {
  constructor(
    private readonly tokens: PasswordResetTokenRepository,
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly policy: PasswordPolicy,
    private readonly hasher: PasswordHasher,
    private readonly notice: PasswordChangeNotice,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  async execute(input: { token: string; newPassword: string }): Promise<void> {
    const reset = await this.transactions.run(async () => {
      const token = await this.tokens.findByHashForUpdate(
        hashLinkToken(input.token),
      );
      const now = this.clock.now();
      if (token === null || !isUsableLink(token, now)) {
        throw new InvalidOrExpiredTokenError();
      }
      const user = await this.users.findById(token.userId);
      if (user === null || !user.canSignIn) {
        throw new InvalidOrExpiredTokenError();
      }
      this.policy.assertAcceptable(input.newPassword, 'newPassword');

      const before = user.snapshot();
      user.resetPassword(await this.hasher.hash(input.newPassword), now);
      await this.tokens.markUsed(token.id, now);
      await this.users.save(user, user.id);
      await this.sessions.revokeAllOf(user.id, now);
      const after = user.snapshot();
      await this.audit.record({
        action: 'auth.password-reset',
        actor: { type: 'USER', id: user.id },
        resource: { type: 'user', id: user.id },
        changes: changesBetween(
          {
            passwordHash: before.passwordHash,
            mustChangePassword: before.mustChangePassword,
          },
          {
            passwordHash: after.passwordHash,
            mustChangePassword: after.mustChangePassword,
          },
        ),
      });
      return {
        account: {
          id: user.id,
          email: after.email as string,
          firstNames: after.firstNames as string,
        },
        at: now,
      };
    });
    await this.notice.send(reset.account, reset.at);
  }
}
