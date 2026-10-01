import { CronExpression } from '@nestjs/schedule';
import { JOBS_TIME_ZONE } from '../../../platform/jobs/scheduled-job.decorator.js';
import type { OrderExpiry } from '../application/order-expiry.use-case.js';
import { OrderExpiryJob } from './order-expiry.job.js';

describe('OrderExpiryJob (ADR-0029, ADR-0136)', () => {
  it('expires the due orders on each run', async () => {
    let runs = 0;
    const job = new OrderExpiryJob({
      expireDue: () => {
        runs += 1;
        return Promise.resolve({ expired: 0, failed: 0 });
      },
    } as unknown as OrderExpiry);

    await job.run();

    expect(runs).toBe(1);
  });

  it('runs every minute, in Mexico time', () => {
    expect(
      Reflect.getMetadata(
        'SCHEDULE_CRON_OPTIONS',
        OrderExpiryJob.prototype.run,
      ),
    ).toMatchObject({
      cronTime: CronExpression.EVERY_MINUTE,
      timeZone: JOBS_TIME_ZONE,
      name: 'ordering.expire-orders',
    });
  });
});
