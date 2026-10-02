import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { ScheduledJob } from '../../../platform/jobs/scheduled-job.decorator.js';
import { TokenCleanup } from '../application/token-cleanup.js';

/** Every day at 3:00, Mexico time, the tokens that no longer work are deleted (ADR-0029, ADR-0144). */
@Injectable()
export class TokenCleanupJob {
  constructor(private readonly cleanup: TokenCleanup) {}

  @ScheduledJob('identity.cleanup-tokens', CronExpression.EVERY_DAY_AT_3AM)
  async run(): Promise<void> {
    await this.cleanup.run();
  }
}
