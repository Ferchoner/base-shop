import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { ScheduledJob } from '../../../platform/jobs/scheduled-job.decorator.js';
import { AccessTokenCleanup } from '../application/access-token-cleanup.js';

/** Every day at 3:00, Mexico time, the spent access links are deleted (UC-SYS-01, ADR-0029, ADR-0148). */
@Injectable()
export class AccessTokenCleanupJob {
  constructor(private readonly cleanup: AccessTokenCleanup) {}

  @ScheduledJob(
    'ordering.cleanup-access-tokens',
    CronExpression.EVERY_DAY_AT_3AM,
  )
  async run(): Promise<void> {
    await this.cleanup.run();
  }
}
