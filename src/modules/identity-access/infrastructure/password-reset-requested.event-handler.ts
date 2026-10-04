import { Injectable } from '@nestjs/common';
import { OnDomainEvent } from '../../../platform/events/on-domain-event.decorator.js';
import {
  type PasswordResetRequested,
  RequestPasswordReset,
} from '../application/request-password-reset.use-case.js';

/**
 * Issues and sends the recovery link that someone asked for (UC-IAM-07, ADR-0154), in the background after the
 * answer (ADR-0098). Running it twice would send a second link that replaces the first; the bus never retries.
 */
@Injectable()
export class PasswordResetRequestedHandler {
  constructor(private readonly requestPasswordReset: RequestPasswordReset) {}

  @OnDomainEvent('PasswordResetRequested')
  async onPasswordResetRequested(event: PasswordResetRequested): Promise<void> {
    await this.requestPasswordReset.execute({ email: event.email });
  }
}
