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
import { PasswordResets } from './password-resets.js';

/**
 * Published when someone asks for a recovery link (UC-IAM-07), so the link is issued and sent in the background: the
 * answer, and how long it takes, never tell whether the email has an account that can sign in (T-310, ADR-0154). It
 * carries the email, so it is volatile and never stored: if it is lost, the person asks again (ADR-0150).
 */
export interface PasswordResetRequested extends DomainEvent<'PasswordResetRequested'> {
  /** Normalized. */
  readonly email: string;
}

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
    private readonly events: DomainEventPublisher,
    private readonly transactions: TransactionManager,
    private readonly clock: Clock,
  ) {}

  /** Accepts a request: the link is issued and sent in the background (`execute`), or nothing is sent. */
  request(email: string): void {
    const event: PasswordResetRequested = {
      ...eventMetadata('PasswordResetRequested', this.clock.now()),
      email: normalizeEmail(email),
    };
    this.events.publishVolatile(event);
  }

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
