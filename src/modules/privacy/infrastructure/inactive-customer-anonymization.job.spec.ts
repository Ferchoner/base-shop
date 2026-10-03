import { CronExpression } from '@nestjs/schedule';
import { JOBS_TIME_ZONE } from '../../../platform/jobs/scheduled-job.decorator.js';
import type { InactiveCustomerAnonymizations } from '../application/inactive-customer-anonymizations.js';
import { InactiveCustomerAnonymizationJob } from './inactive-customer-anonymization.job.js';

describe('InactiveCustomerAnonymizationJob (ADR-0152)', () => {
  it('anonymizes the inactive customers on each run', async () => {
    let runs = 0;
    const job = new InactiveCustomerAnonymizationJob({
      run: () => {
        runs += 1;
        return Promise.resolve({ anonymized: 0, skipped: 0, failed: 0 });
      },
    } as unknown as InactiveCustomerAnonymizations);

    await job.run();

    expect(runs).toBe(1);
  });

  it('runs every day at 3:00, in Mexico time', () => {
    expect(
      Reflect.getMetadata(
        'SCHEDULE_CRON_OPTIONS',
        InactiveCustomerAnonymizationJob.prototype.run,
      ),
    ).toMatchObject({
      cronTime: CronExpression.EVERY_DAY_AT_3AM,
      timeZone: JOBS_TIME_ZONE,
      name: 'privacy.anonymize-inactive-customers',
    });
  });
});
