import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { ScheduledJob } from '../../../platform/jobs/scheduled-job.decorator.js';
import { PersonalDataRetention } from '../application/personal-data-retention.js';

/**
 * Every day at 3:00, Mexico time, the personal data of the orders whose phases ended is blocked or anonymized
 * (UC-SYS-02, ADR-0070, ADR-0151).
 */
@Injectable()
export class PersonalDataRetentionJob {
  constructor(private readonly retention: PersonalDataRetention) {}

  @ScheduledJob('ordering.retention', CronExpression.EVERY_DAY_AT_3AM)
  async run(): Promise<void> {
    await this.retention.run();
  }
}
