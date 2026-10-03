import { CronExpression } from '@nestjs/schedule';
import { JOBS_TIME_ZONE } from '../../../platform/jobs/scheduled-job.decorator.js';
import type { PersonalDataRetention } from '../application/personal-data-retention.js';
import { PersonalDataRetentionJob } from './personal-data-retention.job.js';

describe('PersonalDataRetentionJob (UC-SYS-02, ADR-0149)', () => {
  it('runs the retention cycle on each run', async () => {
    let runs = 0;
    const job = new PersonalDataRetentionJob({
      run: () => {
        runs += 1;
        return Promise.resolve({ blocked: 0, anonymized: 0, failed: 0 });
      },
    } as unknown as PersonalDataRetention);

    await job.run();

    expect(runs).toBe(1);
  });

  it('runs every day at 3:00, in Mexico time', () => {
    expect(
      Reflect.getMetadata(
        'SCHEDULE_CRON_OPTIONS',
        PersonalDataRetentionJob.prototype.run,
      ),
    ).toMatchObject({
      cronTime: CronExpression.EVERY_DAY_AT_3AM,
      timeZone: JOBS_TIME_ZONE,
      name: 'ordering.retention',
    });
  });
});
