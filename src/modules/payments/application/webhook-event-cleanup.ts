import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  Clock,
  daysBefore,
  deleteInBatches,
} from '../../../shared-kernel/index.js';

/**
 * Days a processed webhook event is kept, so a repeated delivery is still recognized (BR-PAY-06, ADR-0029):
 * `PROCESSED_WEBHOOK_EVENT_RETENTION_DAYS`, 30 by default (ADR-0149).
 */
export const PROCESSED_WEBHOOK_EVENT_RETENTION_DAYS = Symbol(
  'PROCESSED_WEBHOOK_EVENT_RETENTION_DAYS',
);

/**
 * Processed webhook events, deleted in batches (ADR-0029, ADR-0144). Each call deletes at most `limit` rows in one
 * statement and answers how many it deleted. An abstract class rather than an interface, so it can be the
 * dependency injection token without depending on NestJS.
 */
export abstract class ProcessedWebhookEvents {
  /** The events processed before `before`. */
  abstract delete(before: Date, limit: number): Promise<number>;
}

/**
 * The daily cleanup of Payments (UC-SYS-01, ADR-0029, ADR-0144): webhook events PROCESSED_WEBHOOK_EVENT_RETENTION_DAYS
 * after they were processed. None exist while PayPal is not enabled (ADR-0040). A system task: not audited.
 */
@Injectable()
export class WebhookEventCleanup {
  private readonly logger = new Logger(WebhookEventCleanup.name);

  constructor(
    private readonly events: ProcessedWebhookEvents,
    private readonly clock: Clock,
    @Inject(PROCESSED_WEBHOOK_EVENT_RETENTION_DAYS)
    private readonly days: number,
  ) {}

  /** Answers how many events it deleted. */
  async run(): Promise<number> {
    const before = daysBefore(this.clock.now(), this.days);
    const deleted = await deleteInBatches((limit) =>
      this.events.delete(before, limit),
    );
    this.logger.log(`Deleted ${deleted} processed webhook events`);
    return deleted;
  }
}
