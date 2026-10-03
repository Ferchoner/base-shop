import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { ScheduledJob } from '../../../platform/jobs/scheduled-job.decorator.js';
import { AuditArchive } from '../application/audit-archive.js';

/**
 * Every day at 3:00, Mexico time, the audit records older than their retention go to the archive files, and the
 * oldest files are deleted (UC-AUD-03, ADR-0029, ADR-0146).
 */
@Injectable()
export class AuditArchiveJob {
  constructor(private readonly archive: AuditArchive) {}

  @ScheduledJob('audit.archive', CronExpression.EVERY_DAY_AT_3AM)
  async run(): Promise<void> {
    await this.archive.run();
  }
}
