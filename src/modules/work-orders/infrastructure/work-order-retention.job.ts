import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { ScheduledJob } from '../../../platform/jobs/scheduled-job.decorator.js';
import { WorkOrderRetention } from '../application/work-order-retention.js';

/**
 * Every day at 3:00, Mexico time, the personal data of the work orders whose phases ended is blocked or anonymized
 * (ADR-0167), as the one of orders (ADR-0151).
 */
@Injectable()
export class WorkOrderRetentionJob {
  constructor(private readonly retention: WorkOrderRetention) {}

  @ScheduledJob('work-orders.retention', CronExpression.EVERY_DAY_AT_3AM)
  async run(): Promise<void> {
    await this.retention.run();
  }
}
