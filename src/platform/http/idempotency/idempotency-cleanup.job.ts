import { Injectable, Logger } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Clock, deleteInBatches } from '../../../shared-kernel/index.js';
import { ScheduledJob } from '../../jobs/scheduled-job.decorator.js';
import { IdempotencyStore } from './idempotency.store.js';

/**
 * Every day at 3:00, Mexico time, the expired idempotency keys are deleted (UC-SYS-01, ADR-0029, ADR-0144): a key
 * lives 24 hours (ADR-0063). The platform owns the table, so its job calls the store directly. A system task: not
 * audited.
 */
@Injectable()
export class IdempotencyCleanupJob {
  private readonly logger = new Logger(IdempotencyCleanupJob.name);

  constructor(
    private readonly store: IdempotencyStore,
    private readonly clock: Clock,
  ) {}

  @ScheduledJob(
    'platform.cleanup-idempotency-keys',
    CronExpression.EVERY_DAY_AT_3AM,
  )
  async run(): Promise<void> {
    await this.cleanUp();
  }

  /** Deletes the expired keys and answers how many. */
  async cleanUp(): Promise<number> {
    const now = this.clock.now();
    const deleted = await deleteInBatches((limit) =>
      this.store.deleteExpired(now, limit),
    );
    this.logger.log(`Deleted ${deleted} expired idempotency keys`);
    return deleted;
  }
}
