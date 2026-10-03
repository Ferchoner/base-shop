import { Injectable } from '@nestjs/common';
import {
  Clock,
  hashLinkToken,
  InvalidOrExpiredTokenError,
  isUsableLink,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import { EmailVerificationTokenRepository } from '../domain/email-verification.js';
import { UserRepository } from '../domain/user.repository.js';

/**
 * Confirms an email with the token of its link (UC-IAM-02, BR-USR-11): once, within its lifetime, and only
 * while the account still has that address and can sign in. Any other case answers 400
 * `invalid-or-expired-token` (E-20), without saying which.
 */
@Injectable()
export class ConfirmEmail {
  constructor(
    private readonly tokens: EmailVerificationTokenRepository,
    private readonly users: UserRepository,
    private readonly transactions: TransactionManager,
    private readonly clock: Clock,
  ) {}

  execute(input: { token: string }): Promise<void> {
    return this.transactions.run(async () => {
      const token = await this.tokens.findByHashForUpdate(
        hashLinkToken(input.token),
      );
      const now = this.clock.now();
      if (token === null || !isUsableLink(token, now)) {
        throw new InvalidOrExpiredTokenError();
      }
      const user = await this.users.findById(token.userId);
      if (user === null || !user.verifyEmail(token.email, now)) {
        throw new InvalidOrExpiredTokenError();
      }
      await this.tokens.markUsed(token.id, now);
      await this.users.save(user, null);
    });
  }
}
