import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { ScheduledJob } from '../jobs/scheduled-job.decorator.js';
import { DeliveredEventCleanup } from './delivered-event-cleanup.js';

/** Every day at 3:00, Mexico time, the delivered domain events are deleted (UC-SYS-01, ADR-0144, ADR-0150). */
@Injectable()
export class DeliveredEventCleanupJob {
  constructor(private readonly cleanup: DeliveredEventCleanup) {}

  @ScheduledJob('platform.cleanup-events', CronExpression.EVERY_DAY_AT_3AM)
  async run(): Promise<void> {
    await this.cleanup.run();
  }
}
