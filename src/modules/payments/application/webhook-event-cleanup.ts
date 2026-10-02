import { Injectable, Logger } from '@nestjs/common';
import {
  Clock,
  daysBefore,
  deleteInBatches,
} from '../../../shared-kernel/index.js';

/** Days a processed webhook event is kept, so a repeated delivery is still recognized (BR-PAY-06, ADR-0029). */
export const PROCESSED_WEBHOOK_EVENT_DAYS = 30;

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
 * The daily cleanup of Payments (UC-SYS-01, ADR-0029, ADR-0144): webhook events 30 days after they were
 * processed. None exist while PayPal is not enabled (ADR-0040). A system task: not audited.
 */
@Injectable()
export class WebhookEventCleanup {
  private readonly logger = new Logger(WebhookEventCleanup.name);

  constructor(
    private readonly events: ProcessedWebhookEvents,
    private readonly clock: Clock,
  ) {}

  /** Answers how many events it deleted. */
  async run(): Promise<number> {
    const before = daysBefore(this.clock.now(), PROCESSED_WEBHOOK_EVENT_DAYS);
    const deleted = await deleteInBatches((limit) =>
      this.events.delete(before, limit),
    );
    this.logger.log(`Deleted ${deleted} processed webhook events`);
    return deleted;
  }
}
