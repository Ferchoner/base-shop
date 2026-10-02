import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { ScheduledJob } from '../../../platform/jobs/scheduled-job.decorator.js';
import { WebhookEventCleanup } from '../application/webhook-event-cleanup.js';

/** Every day at 3:00, Mexico time, the old processed webhook events are deleted (ADR-0029, ADR-0144). */
@Injectable()
export class WebhookEventCleanupJob {
  constructor(private readonly cleanup: WebhookEventCleanup) {}

  @ScheduledJob(
    'payments.cleanup-webhook-events',
    CronExpression.EVERY_DAY_AT_3AM,
  )
  async run(): Promise<void> {
    await this.cleanup.run();
  }
}
