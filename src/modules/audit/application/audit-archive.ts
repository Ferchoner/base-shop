import { Inject, Injectable, Logger } from '@nestjs/common';
import { Clock, TransactionManager } from '../../../shared-kernel/index.js';
import type { AuditEntryView, AuditPosition } from './audit-entries.js';

/** Records read and written at a time (ADR-0144). */
export const ARCHIVE_BATCH_SIZE = 1_000;

/** Days archived in one run at most; the rest, in the next ones. */
export const MAX_DAYS_PER_RUN = 31;

/**
 * How long the audit trail is kept (ADR-0037), in calendar months: in the database, and then in the archive files.
 * Pending legal validation (P-61).
 */
export interface AuditRetention {
  readonly databaseMonths: number;
  readonly archiveMonths: number;
}

/** Dependency injection token of the `AuditRetention` (`AUDIT_RETENTION_MONTHS`, `AUDIT_ARCHIVE_RETENTION_MONTHS`). */
export const AUDIT_RETENTION = Symbol('AUDIT_RETENTION');

/** A day in UTC, as `YYYY-MM-DD`: the unit of the archive, because the audit trail records UTC (ADR-0146). */
export type UtcDay = string;

/**
 * The records of the audit trail that leave the database. An abstract class rather than an interface, so it can be
 * the dependency injection token without depending on NestJS.
 */
export abstract class ArchivableAuditLogs {
  /** The days with records before `cutoff`, oldest first, up to `limit`. */
  abstract daysBefore(cutoff: Date, limit: number): Promise<UtcDay[]>;

  /** Up to `limit` records of the day after `position`, or from its first one, oldest first; ties by ID. */
  abstract entriesOf(
    day: UtcDay,
    position: AuditPosition | null,
    limit: number,
  ): Promise<AuditEntryView[]>;

  /** Deletes every record of the day, in the transaction of the caller, and answers their IDs. */
  abstract deleteDay(day: UtcDay): Promise<string[]>;
}

/** A file of the archive being written: it counts as archived only once it is kept. */
export interface ArchiveDraft {
  append(entries: readonly AuditEntryView[]): Promise<void>;

  /** Ends the file, forces it to disk and reads it back, decompressed: the IDs it holds, in their order. */
  close(): Promise<string[]>;

  /**
   * Gives the closed file its final name, after the files the day already has, never replacing one, and forces the
   * folder to disk. Answers the name.
   */
  keep(): Promise<string>;

  /** Deletes the file being written; a kept file stays under its name. Discarding twice changes nothing. */
  discard(): Promise<void>;
}

/**
 * The archive files of the audit trail (ADR-0037): JSON Lines with gzip, one or more per day, in a private folder.
 * An abstract class rather than an interface, so it can be the dependency injection token without depending on
 * NestJS.
 */
export abstract class AuditArchiveFiles {
  /** Deletes what a run left half written: it never counts as archived, and its records are still in the database. */
  abstract discardUnfinished(): Promise<void>;

  abstract start(day: UtcDay): Promise<ArchiveDraft>;

  /** Deletes the files of the days before `day`, and answers how many. */
  abstract deleteBefore(day: UtcDay): Promise<number>;
}

/** What a run of the archive did. */
export interface ArchiveRun {
  readonly archivedDays: number;
  readonly archivedEntries: number;
  /** Days left in the database, to try again in the next run. */
  readonly failedDays: number;
  readonly deletedFiles: number;
}

/**
 * The archive of the audit trail (UC-AUD-03, ADR-0037, ADR-0146), every day. Each whole UTC day older than the
 * database retention goes to a new file, which is read back and compared before its records leave the database. A
 * day already archived that still has records gets another file, never replacing the first one. Files older than
 * the archive retention are deleted. A system task: not audited.
 */
@Injectable()
export class AuditArchive {
  private readonly logger = new Logger(AuditArchive.name);

  constructor(
    private readonly logs: ArchivableAuditLogs,
    private readonly files: AuditArchiveFiles,
    private readonly transactions: TransactionManager,
    private readonly clock: Clock,
    @Inject(AUDIT_RETENTION) private readonly retention: AuditRetention,
  ) {}

  async run(): Promise<ArchiveRun> {
    const now = this.clock.now();
    await this.files.discardUnfinished();
    const cutoff = startOf(
      utcDayOf(monthsBefore(now, this.retention.databaseMonths)),
    );
    const days = await this.logs.daysBefore(cutoff, MAX_DAYS_PER_RUN);
    let archivedDays = 0;
    let archivedEntries = 0;
    let failedDays = 0;
    for (const day of days) {
      try {
        const archived = await this.archive(day);
        if (archived > 0) {
          archivedEntries += archived;
          archivedDays += 1;
        }
      } catch (error) {
        failedDays += 1;
        this.logger.error(
          `Audit records of ${day} were not archived, and stay in the database: ${(error as Error).message}`,
        );
      }
    }
    const deletedFiles = await this.files.deleteBefore(
      utcDayOf(monthsBefore(now, this.retention.archiveMonths)),
    );
    this.logger.log(
      `Audit archive: ${archivedEntries} records of ${archivedDays} days archived, ${failedDays} days failed, ${deletedFiles} old files deleted`,
    );
    return { archivedDays, archivedEntries, failedDays, deletedFiles };
  }

  /**
   * Exports the day to a file, keeps it once it holds exactly what was exported, and then deletes exactly those
   * records: if the day has others by then, nothing is deleted, and the next run archives it again.
   *
   * @returns how many records left the database.
   */
  private async archive(day: UtcDay): Promise<number> {
    const draft = await this.files.start(day);
    const exported: string[] = [];
    try {
      let position: AuditPosition | null = null;
      for (;;) {
        const batch = await this.logs.entriesOf(
          day,
          position,
          ARCHIVE_BATCH_SIZE,
        );
        if (batch.length > 0) {
          await draft.append(batch);
          exported.push(...batch.map(({ id }) => id));
          const last = batch[batch.length - 1];
          position = { occurredAt: last.occurredAt, id: last.id };
        }
        if (batch.length < ARCHIVE_BATCH_SIZE) break;
      }
      // Its records left meanwhile: nothing to keep.
      if (exported.length === 0) {
        await draft.discard();
        return 0;
      }
      const readBack = await draft.close();
      if (!sameSequence(readBack, exported)) {
        throw new Error('the file read back does not hold what was exported');
      }
      await draft.keep();
    } catch (error) {
      await draft.discard();
      throw error;
    }
    await this.transactions.run(async () => {
      const deleted = await this.logs.deleteDay(day);
      if (!sameSequence([...deleted].sort(), [...exported].sort())) {
        throw new Error(
          'the day has other records than the file, so none were deleted',
        );
      }
    });
    return exported.length;
  }
}

/** The same instant `months` calendar months before; on the last day of the month when it is shorter. */
export function monthsBefore(now: Date, months: number): Date {
  const target = new Date(now.getTime());
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() - months);
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(now.getUTCDate(), lastDay));
  return target;
}

/** The UTC day of an instant. */
export function utcDayOf(at: Date): UtcDay {
  return at.toISOString().slice(0, 10);
}

/** The first instant of a UTC day. */
export function startOf(day: UtcDay): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

function sameSequence(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}
