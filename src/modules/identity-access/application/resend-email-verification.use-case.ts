import { Injectable } from '@nestjs/common';
import { Clock, TransactionManager } from '../../../shared-kernel/index.js';
import { normalizeEmail } from '../domain/user.js';
import { UserRepository } from '../domain/user.repository.js';
import { EmailVerifications } from './email-verifications.js';

/**
 * Sends a new verification link (UC-IAM-03, BR-USR-12), which invalidates the earlier ones. Only an active
 * customer with an unverified email gets it; for any other email (unknown, verified, suspended or staff)
 * nothing happens. The caller answers the same in every case, so the response never tells whether the email
 * exists (ADR-0117).
 */
@Injectable()
export class ResendEmailVerification {
  constructor(
    private readonly users: UserRepository,
    private readonly verifications: EmailVerifications,
    private readonly transactions: TransactionManager,
    private readonly clock: Clock,
  ) {}

  async execute(input: { email: string }): Promise<void> {
    const issued = await this.transactions.run(async () => {
      const user = await this.users.findByEmail(normalizeEmail(input.email));
      if (
        user === null ||
        user.type !== 'CUSTOMER' ||
        !user.canSignIn ||
        user.emailVerified
      ) {
        return null;
      }
      const address = user.email as string;
      const token = await this.verifications.issue(
        user.id,
        address,
        this.clock.now(),
      );
      return {
        account: {
          id: user.id,
          email: address,
          firstNames: user.snapshot().firstNames as string,
        },
        token,
      };
    });
    if (issued !== null) {
      await this.verifications.send(issued.account, issued.token);
    }
  }
}
