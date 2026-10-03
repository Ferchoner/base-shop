import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import type { TransactionManager } from '../../../shared-kernel/index.js';
import {
  ARCHIVE_BATCH_SIZE,
  ArchivableAuditLogs,
  type ArchiveDraft,
  AuditArchive,
  AuditArchiveFiles,
  MAX_DAYS_PER_RUN,
  monthsBefore,
  startOf,
  type UtcDay,
  utcDayOf,
} from './audit-archive.js';
import type { AuditEntryView, AuditPosition } from './audit-entries.js';

/** 3:00 in Mexico on October 3, 2026: the cutoff is July 3, 00:00 UTC. */
const NOW = new Date('2026-10-03T09:00:00.000Z');

let sequence = 0;

/** A record at `at`, with an ID that sorts in the order of creation. */
function entry(at: string): AuditEntryView {
  sequence += 1;
  return {
    id: `01a0f000-0000-7000-8000-${String(sequence).padStart(12, '0')}`,
    occurredAt: new Date(at),
    actorType: 'USER',
    actorId: '01a0f000-0000-7000-8000-999999999999',
    action: 'orders.cancel',
    resourceType: 'order',
    resourceId: 'order-1',
    result: 'SUCCESS',
    correlationId: 'correlation-1',
    ip: '203.0.113.7',
    userAgent: 'test',
    changes: { status: { from: 'PAID', to: 'CANCELLED' } },
    reason: 'Duplicada',
  };
}

/** The records of `audit_logs` in memory; a delete inside a transaction that fails is undone. */
class InMemoryLogs extends ArchivableAuditLogs {
  entries: AuditEntryView[];
  readonly reads: string[] = [];
  /** Records that appear in a day after it was exported, before it is deleted. */
  lateArrivals: AuditEntryView[] = [];

  constructor(entries: AuditEntryView[]) {
    super();
    this.entries = [...entries];
  }

  daysBefore(cutoff: Date, limit: number): Promise<UtcDay[]> {
    this.reads.push(`daysBefore ${cutoff.toISOString()} ${limit}`);
    const days = [
      ...new Set(
        this.entries
          .filter(({ occurredAt }) => occurredAt < cutoff)
          .map(({ occurredAt }) => utcDayOf(occurredAt)),
      ),
    ].sort();
    return Promise.resolve(days.slice(0, limit));
  }

  entriesOf(
    day: UtcDay,
    position: AuditPosition | null,
    limit: number,
  ): Promise<AuditEntryView[]> {
    this.reads.push(
      `entriesOf ${day} ${position === null ? 'start' : position.id} ${limit}`,
    );
    const found = this.ofDay(day)
      .filter(
        (candidate) =>
          position === null ||
          candidate.occurredAt > position.occurredAt ||
          (candidate.occurredAt.getTime() === position.occurredAt.getTime() &&
            candidate.id > position.id),
      )
      .slice(0, limit);
    return Promise.resolve(found);
  }

  /** Other transactions commit the late records. */
  arrive(): void {
    this.entries.push(...this.lateArrivals);
    this.lateArrivals = [];
  }

  deleteDay(day: UtcDay): Promise<string[]> {
    const deleted = this.ofDay(day).map(({ id }) => id);
    this.entries = this.entries.filter(
      ({ occurredAt }) => utcDayOf(occurredAt) !== day,
    );
    return Promise.resolve(deleted.reverse());
  }

  ofDay(day: UtcDay): AuditEntryView[] {
    return this.entries
      .filter(({ occurredAt }) => utcDayOf(occurredAt) === day)
      .sort(
        (a, b) =>
          a.occurredAt.getTime() - b.occurredAt.getTime() ||
          a.id.localeCompare(b.id),
      );
  }
}

/** Archive files in memory: each draft keeps what it was given, and a day can get several kept files. */
class InMemoryFiles extends AuditArchiveFiles {
  readonly calls: string[] = [];
  readonly kept: { day: UtcDay; ids: string[] }[] = [];
  /** Days whose file reads back something else, or cannot be kept. */
  readonly corrupt = new Set<UtcDay>();
  readonly unkeepable = new Set<UtcDay>();

  discardUnfinished(): Promise<void> {
    this.calls.push('discardUnfinished');
    return Promise.resolve();
  }

  start(day: UtcDay): Promise<ArchiveDraft> {
    const ids: string[] = [];
    const appended: number[] = [];
    this.calls.push(`start ${day}`);
    return Promise.resolve({
      append: (entries) => {
        appended.push(entries.length);
        ids.push(...entries.map(({ id }) => id));
        return Promise.resolve();
      },
      close: () => {
        this.calls.push(`close ${day} ${appended.join(',')}`);
        return Promise.resolve(this.corrupt.has(day) ? ids.slice(1) : [...ids]);
      },
      keep: () => {
        if (this.unkeepable.has(day)) {
          return Promise.reject(new Error('disk full'));
        }
        this.calls.push(`keep ${day}`);
        this.kept.push({ day, ids: [...ids] });
        return Promise.resolve(`audit-${day}.jsonl.gz`);
      },
      discard: () => {
        this.calls.push(`discard ${day}`);
        return Promise.resolve();
      },
    });
  }

  deleteBefore(day: UtcDay): Promise<number> {
    this.calls.push(`deleteBefore ${day}`);
    return Promise.resolve(2);
  }
}

function setUp(entries: AuditEntryView[]) {
  const logs = new InMemoryLogs(entries);
  const files = new InMemoryFiles();
  const transactions = {
    run: async <T>(work: () => Promise<T>) => {
      logs.arrive();
      const before = [...logs.entries];
      try {
        return await work();
      } catch (error) {
        logs.entries = before;
        throw error;
      }
    },
  } as unknown as TransactionManager;
  const archive = new AuditArchive(
    logs,
    files,
    transactions,
    { now: () => NOW },
    { databaseMonths: 3, archiveMonths: 24 },
  );
  return { archive, logs, files };
}

describe('AuditArchive (UC-AUD-03, ADR-0037, ADR-0146)', () => {
  let error: jest.SpiedFunction<Logger['error']>;
  let log: jest.SpiedFunction<Logger['log']>;

  beforeEach(() => {
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('archives each whole UTC day before the retention to a file, and then deletes its records', async () => {
    const first = [
      entry('2026-07-01T00:00:00.000Z'),
      entry('2026-07-01T23:59:59.999Z'),
    ];
    const second = [entry('2026-07-02T23:59:59.999Z')];
    const kept = [
      entry('2026-07-03T00:00:00.000Z'),
      entry('2026-10-01T12:00:00.000Z'),
    ];
    const { archive, logs, files } = setUp([...kept, ...second, ...first]);

    expect(await archive.run()).toEqual({
      archivedDays: 2,
      archivedEntries: 3,
      failedDays: 0,
      deletedFiles: 2,
    });

    expect(files.kept).toEqual([
      { day: '2026-07-01', ids: first.map(({ id }) => id) },
      { day: '2026-07-02', ids: second.map(({ id }) => id) },
    ]);
    expect(logs.entries).toEqual(kept);
    expect(logs.reads[0]).toBe(
      `daysBefore 2026-07-03T00:00:00.000Z ${MAX_DAYS_PER_RUN}`,
    );
    expect(files.calls).toEqual([
      'discardUnfinished',
      'start 2026-07-01',
      'close 2026-07-01 2',
      'keep 2026-07-01',
      'start 2026-07-02',
      'close 2026-07-02 1',
      'keep 2026-07-02',
      'deleteBefore 2024-10-03',
    ]);
    expect(log.mock.calls).toEqual([
      [
        'Audit archive: 3 records of 2 days archived, 0 days failed, 2 old files deleted',
      ],
    ]);
  });

  it('reads and writes a day in batches, from the last record of each one', async () => {
    const day = Array.from({ length: ARCHIVE_BATCH_SIZE * 2 + 1 }, (_, index) =>
      entry(`2026-06-30T10:00:00.${String(index % 1000).padStart(3, '0')}Z`),
    );
    const { archive, logs, files } = setUp(day);
    const ordered = logs.ofDay('2026-06-30');

    await archive.run();

    expect(logs.reads.slice(1)).toEqual([
      `entriesOf 2026-06-30 start ${ARCHIVE_BATCH_SIZE}`,
      `entriesOf 2026-06-30 ${ordered[ARCHIVE_BATCH_SIZE - 1].id} ${ARCHIVE_BATCH_SIZE}`,
      `entriesOf 2026-06-30 ${ordered[ARCHIVE_BATCH_SIZE * 2 - 1].id} ${ARCHIVE_BATCH_SIZE}`,
    ]);
    expect(files.calls).toContain(
      `close 2026-06-30 ${ARCHIVE_BATCH_SIZE},${ARCHIVE_BATCH_SIZE},1`,
    );
    expect(files.kept[0].ids).toEqual(ordered.map(({ id }) => id));
    expect(logs.entries).toEqual([]);
  });

  it('asks once more after a full batch, and ends on an empty one', async () => {
    const day = Array.from({ length: ARCHIVE_BATCH_SIZE }, () =>
      entry('2026-06-30T10:00:00.000Z'),
    );
    const { archive, logs } = setUp(day);

    expect((await archive.run()).archivedEntries).toBe(ARCHIVE_BATCH_SIZE);
    expect(logs.reads).toHaveLength(3);
  });

  it('keeps the records of a day whose file does not read back what was exported, and goes on with the next', async () => {
    const corrupt = [entry('2026-06-01T10:00:00.000Z')];
    const good = [entry('2026-06-02T10:00:00.000Z')];
    const { archive, logs, files } = setUp([...corrupt, ...good]);
    files.corrupt.add('2026-06-01');

    expect(await archive.run()).toMatchObject({
      archivedDays: 1,
      archivedEntries: 1,
      failedDays: 1,
    });

    expect(logs.entries).toEqual(corrupt);
    expect(files.calls.slice(1, 4)).toEqual([
      'start 2026-06-01',
      'close 2026-06-01 1',
      'discard 2026-06-01',
    ]);
    expect(files.kept.map(({ day }) => day)).toEqual(['2026-06-02']);
    expect(error.mock.calls).toEqual([
      [
        'Audit records of 2026-06-01 were not archived, and stay in the database: the file read back does not hold what was exported',
      ],
    ]);
  });

  it('keeps the records of a day whose file cannot be kept', async () => {
    const day = [entry('2026-06-01T10:00:00.000Z')];
    const { archive, logs, files } = setUp(day);
    files.unkeepable.add('2026-06-01');

    expect((await archive.run()).failedDays).toBe(1);

    expect(logs.entries).toEqual(day);
    expect(files.calls).toContain('discard 2026-06-01');
  });

  it('deletes nothing of a day that has other records than its file by then, which stays, and archives it again in the next run', async () => {
    const day = [entry('2026-06-01T10:00:00.000Z')];
    const late = entry('2026-06-01T11:00:00.000Z');
    const { archive, logs, files } = setUp(day);
    logs.lateArrivals = [late];

    expect((await archive.run()).failedDays).toBe(1);

    expect(logs.entries).toEqual([...day, late]);
    expect(files.kept).toEqual([{ day: '2026-06-01', ids: [day[0].id] }]);
    expect(files.calls).not.toContain('discard 2026-06-01');
    expect(error.mock.calls[0][0]).toContain(
      'the day has other records than the file, so none were deleted',
    );

    expect(await archive.run()).toMatchObject({
      archivedDays: 1,
      archivedEntries: 2,
      failedDays: 0,
    });
    expect(files.kept[1]).toEqual({
      day: '2026-06-01',
      ids: [day[0].id, late.id],
    });
    expect(logs.entries).toEqual([]);
  });

  it('keeps no file for a day whose records left meanwhile', async () => {
    const { archive, logs, files } = setUp([entry('2026-06-01T10:00:00.000Z')]);
    logs.entriesOf = () => Promise.resolve([]);

    expect(await archive.run()).toMatchObject({
      archivedDays: 0,
      archivedEntries: 0,
      failedDays: 0,
    });
    expect(files.calls).toEqual([
      'discardUnfinished',
      'start 2026-06-01',
      'discard 2026-06-01',
      'deleteBefore 2024-10-03',
    ]);
  });
});

describe('Dates of the archive', () => {
  it('goes back calendar months, to the last day of a shorter month', () => {
    expect(monthsBefore(new Date('2026-10-03T09:00:00.000Z'), 3)).toEqual(
      new Date('2026-07-03T09:00:00.000Z'),
    );
    expect(monthsBefore(new Date('2026-05-31T09:00:00.000Z'), 3)).toEqual(
      new Date('2026-02-28T09:00:00.000Z'),
    );
    expect(monthsBefore(new Date('2026-01-15T00:00:00.000Z'), 24)).toEqual(
      new Date('2024-01-15T00:00:00.000Z'),
    );
    expect(monthsBefore(new Date('2026-03-31T23:00:00.000Z'), 1)).toEqual(
      new Date('2026-02-28T23:00:00.000Z'),
    );
  });

  it('names a UTC day, and starts it at midnight UTC', () => {
    expect(utcDayOf(new Date('2026-07-01T23:59:59.999-06:00'))).toBe(
      '2026-07-02',
    );
    expect(startOf('2026-07-02')).toEqual(new Date('2026-07-02T00:00:00.000Z'));
  });
});
