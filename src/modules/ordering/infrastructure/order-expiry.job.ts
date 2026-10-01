import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { ScheduledJob } from '../../../platform/jobs/scheduled-job.decorator.js';
import { OrderExpiry } from '../application/order-expiry.use-case.js';

/** Every minute, the orders that were not paid in time expire with their reservations (ADR-0029, ADR-0136). */
@Injectable()
export class OrderExpiryJob {
  constructor(private readonly expiry: OrderExpiry) {}

  @ScheduledJob('ordering.expire-orders', CronExpression.EVERY_MINUTE)
  async run(): Promise<void> {
    await this.expiry.expireDue();
  }
}
