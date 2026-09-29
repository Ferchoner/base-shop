import { Injectable } from '@nestjs/common';
import { Clock, TransactionManager } from '../../../shared-kernel/index.js';
import { normalizeEmail } from '../domain/user.js';
import { UserRepository } from '../domain/user.repository.js';
import { PasswordResets } from './password-resets.js';

/**
 * Sends a password recovery link (UC-IAM-07, BR-USR-16), which invalidates the earlier ones. Customers and
 * staff get it while their account can sign in; suspended accounts and unknown emails get nothing (ADR-0056).
 * The caller answers the same in every case, so the response never tells whether the email exists.
 */
@Injectable()
export class RequestPasswordReset {
  constructor(
    private readonly users: UserRepository,
    private readonly resets: PasswordResets,
    private readonly transactions: TransactionManager,
    private readonly clock: Clock,
  ) {}

  async execute(input: { email: string }): Promise<void> {
    const issued = await this.transactions.run(async () => {
      const user = await this.users.findByEmail(normalizeEmail(input.email));
      if (user === null || !user.canSignIn) return null;
      const token = await this.resets.issue(user.id, this.clock.now());
      const { email, firstNames } = user.snapshot();
      return {
        account: {
          id: user.id,
          email: email as string,
          firstNames: firstNames as string,
        },
        token,
      };
    });
    if (issued !== null) await this.resets.send(issued.account, issued.token);
  }
}
