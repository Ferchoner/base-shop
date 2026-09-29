import { Injectable } from '@nestjs/common';
import {
  Clock,
  newId,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import { User, type UserId } from '../domain/user.js';
import { UserRepository } from '../domain/user.repository.js';
import { EmailVerifications } from './email-verifications.js';
import { PasswordHasher } from './password-hasher.js';
import { PasswordPolicy } from './password-policy.js';

/**
 * A customer signs up (UC-IAM-01, BR-USR-15): the password follows the policy (ADR-0047), the email must be
 * free, and a verification link goes out after the commit (ADR-0046). It does not sign in. A taken email is
 * answered as such, so the person can sign in or recover their account (ADR-0062).
 */
@Injectable()
export class RegisterCustomer {
  constructor(
    private readonly users: UserRepository,
    private readonly policy: PasswordPolicy,
    private readonly hasher: PasswordHasher,
    private readonly verifications: EmailVerifications,
    private readonly transactions: TransactionManager,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    email: string;
    password: string;
    firstNames: string;
    lastNames: string;
    privacyNoticeVersion: string;
  }): Promise<UserId> {
    this.policy.assertAcceptable(input.password, 'password');
    const passwordHash = await this.hasher.hash(input.password);
    const { user, token } = await this.transactions.run(async () => {
      const now = this.clock.now();
      const user = User.registerCustomer({
        id: newId(),
        email: input.email,
        firstNames: input.firstNames,
        lastNames: input.lastNames,
        passwordHash,
        privacyNoticeVersion: input.privacyNoticeVersion,
        now,
      });
      await this.users.add(user, null);
      const address = user.email as string;
      return {
        user,
        token: await this.verifications.issue(user.id, address, now),
      };
    });
    await this.verifications.send(
      {
        id: user.id,
        email: user.email as string,
        firstNames: input.firstNames,
      },
      token,
    );
    return user.id;
  }
}
