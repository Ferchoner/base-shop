import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { ScheduledJob } from '../../../platform/jobs/scheduled-job.decorator.js';
import { GuestCartCleanup } from '../application/guest-cart-cleanup.js';

/** Every day at 3:00, Mexico time, the inactive guest carts are deleted (UC-CRT-07, ADR-0029, ADR-0144). */
@Injectable()
export class GuestCartCleanupJob {
  constructor(private readonly cleanup: GuestCartCleanup) {}

  @ScheduledJob('shopping.cleanup-guest-carts', CronExpression.EVERY_DAY_AT_3AM)
  async run(): Promise<void> {
    await this.cleanup.run();
  }
}
