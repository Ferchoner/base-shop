import { Injectable } from '@nestjs/common';
import {
  Clock,
  type DomainEvent,
  DomainEventPublisher,
  eventMetadata,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import { normalizeEmail } from '../domain/user.js';
import { UserRepository } from '../domain/user.repository.js';
import { EmailVerifications } from './email-verifications.js';

/**
 * Published when someone asks for a new verification link (UC-IAM-03), so the link is issued and sent in the
 * background: the answer, and how long it takes, never tell whether the email has an unverified account (T-310,
 * ADR-0154). It carries the email, so it is volatile and never stored: if it is lost, the person asks again
 * (ADR-0150).
 */
export interface EmailVerificationRequested extends DomainEvent<'EmailVerificationRequested'> {
  /** Normalized. */
  readonly email: string;
}

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
    private readonly events: DomainEventPublisher,
    private readonly transactions: TransactionManager,
    private readonly clock: Clock,
  ) {}

  /** Accepts a request: the link is issued and sent in the background (`execute`), or nothing is sent. */
  request(email: string): void {
    const event: EmailVerificationRequested = {
      ...eventMetadata('EmailVerificationRequested', this.clock.now()),
      email: normalizeEmail(email),
    };
    this.events.publishVolatile(event);
  }

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
