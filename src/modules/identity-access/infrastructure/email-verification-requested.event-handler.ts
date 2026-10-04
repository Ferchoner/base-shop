import { Injectable } from '@nestjs/common';
import { OnDomainEvent } from '../../../platform/events/on-domain-event.decorator.js';
import {
  type EmailVerificationRequested,
  ResendEmailVerification,
} from '../application/resend-email-verification.use-case.js';

/**
 * Issues and sends the verification link that someone asked for again (UC-IAM-03, ADR-0154), in the background after
 * the answer (ADR-0098). Running it twice would send a second link that replaces the first; the bus never retries.
 */
@Injectable()
export class EmailVerificationRequestedHandler {
  constructor(
    private readonly resendEmailVerification: ResendEmailVerification,
  ) {}

  @OnDomainEvent('EmailVerificationRequested')
  async onEmailVerificationRequested(
    event: EmailVerificationRequested,
  ): Promise<void> {
    await this.resendEmailVerification.execute({ email: event.email });
  }
}
