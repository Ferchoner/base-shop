import { CronExpression } from '@nestjs/schedule';
import { JOBS_TIME_ZONE } from '../../../platform/jobs/scheduled-job.decorator.js';
import type { WorkOrderRetention } from '../application/work-order-retention.js';
import { WorkOrderRetentionJob } from './work-order-retention.job.js';

describe('WorkOrderRetentionJob (ADR-0167)', () => {
  it('runs the retention cycle of work orders on each run', async () => {
    let runs = 0;
    const job = new WorkOrderRetentionJob({
      run: () => {
        runs += 1;
        return Promise.resolve({ blocked: 0, anonymized: 0, failed: 0 });
      },
    } as unknown as WorkOrderRetention);

    await job.run();

    expect(runs).toBe(1);
  });

  it('runs every day at 3:00, in Mexico time', () => {
    expect(
      Reflect.getMetadata(
        'SCHEDULE_CRON_OPTIONS',
        WorkOrderRetentionJob.prototype.run,
      ),
    ).toMatchObject({
      cronTime: CronExpression.EVERY_DAY_AT_3AM,
      timeZone: JOBS_TIME_ZONE,
      name: 'work-orders.retention',
    });
  });
});
