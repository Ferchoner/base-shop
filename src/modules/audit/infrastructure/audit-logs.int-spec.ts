import { jest } from '@jest/globals';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import { ClockModule } from '../../../platform/clock/clock.module.js';
import type { Prisma } from '../../../platform/persistence/prisma/generated/client.js';
import { validateEnvironment } from '../../../platform/config/environment.js';
import { PersistenceModule } from '../../../platform/persistence/persistence.module.js';
import { PrismaService } from '../../../platform/persistence/prisma.service.js';
import { Clock, newId } from '../../../shared-kernel/index.js';
import {
  ArchivableAuditLogs,
  AuditArchive,
} from '../application/audit-archive.js';
import {
  type AuditEntryView,
  type AuditFilter,
  AuditQueries,
} from '../application/audit-entries.js';
import { AuditModule } from '../audit.module.js';
import { AuditArchiveJob } from './audit-archive.job.js';
import { AUDIT_ARCHIVE_SETTINGS } from './local-disk-audit-archive-files.js';

/** 3:00 in Mexico on October 3, 2026: the cutoff is July 3, 00:00 UTC. */
const NOW = new Date('2026-10-03T09:00:00.000Z');

type Row = Omit<AuditEntryView, 'id'> & { id?: string };

const row = (occurredAt: string, changes: Partial<Row> = {}): Row => ({
  occurredAt: new Date(occurredAt),
  actorType: 'USER',
  actorId: '01a0f000-0000-7000-8000-999999999999',
  action: 'orders.cancel',
  resourceType: 'order',
  resourceId: 'order-1',
  result: 'SUCCESS',
  correlationId: 'correlation-1',
  ip: '203.0.113.7',
  userAgent: 'Mozilla/5.0',
  changes: { status: { from: 'PAID', to: 'CANCELLED' } },
  reason: 'Duplicada',
  ...changes,
});

/** The audit trail against PostgreSQL 18: the staff's reading and the daily archive (T-220, ADR-0146). */
describe('Audit query and archive (T-220)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cls: ClsService;
  let parent: string;
  let directory: string;

  beforeAll(async () => {
    parent = await mkdtemp(path.join(tmpdir(), 'base-shop-audit-'));
    directory = path.join(parent, 'audit');
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          validate: validateEnvironment,
        }),
        ClsModule.forRoot({ global: true }),
        PersistenceModule,
        ClockModule,
        AuditModule,
      ],
    })
      .overrideProvider(Clock)
      .useValue({ now: () => NOW })
      .overrideProvider(AUDIT_ARCHIVE_SETTINGS)
      .useValue({ directory })
      .compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    cls = moduleRef.get(ClsService);
  });

  afterAll(async () => {
    await moduleRef.close();
    await rm(parent, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await prisma.auditLog.deleteMany();
    await rm(directory, { recursive: true, force: true });
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await prisma.auditLog.deleteMany();
  });

  /** Inserts the records, each with a new ID unless it has one, and answers them as the API shows them. */
  async function insert(...rows: Row[]): Promise<AuditEntryView[]> {
    const entries = rows.map((candidate) => ({
      ...candidate,
      id: candidate.id ?? newId(),
    }));
    await prisma.auditLog.createMany({
      data: entries.map((entry) => ({
        ...entry,
        changes: (entry.changes ?? undefined) as Prisma.InputJsonObject,
      })),
    });
    return entries;
  }

  const ids = (entries: readonly { id: string }[]) =>
    entries.map(({ id }) => id);

  describe('the query (UC-AUD-02)', () => {
    const list = (
      filter: AuditFilter = {},
      position: Parameters<AuditQueries['list']>[1] = null,
      limit = 50,
    ) => moduleRef.get(AuditQueries).list(filter, position, limit);

    it('reads every field, newest first, with ties broken by ID, and continues after a position', async () => {
      const at = '2026-10-02T12:00:00.000Z';
      const [older] = await insert(
        row('2026-10-02T11:00:00.000Z', {
          ip: null,
          changes: null,
          reason: null,
        }),
      );
      const tied = await insert(row(at), row(at), row(at));
      const byId = [...tied].sort((a, b) => b.id.localeCompare(a.id));

      const all = await list();

      expect(all).toEqual([...byId, older]);
      expect(await list({}, byId[1], 50)).toEqual([byId[2], older]);
      expect(await list({}, null, 2)).toEqual(byId.slice(0, 2));
    });

    it('filters by actor, action or prefix, resource, result and time, both ends included', async () => {
      const staff = newId();
      const [mine, denied, system, other, early, late] = await insert(
        row('2026-10-02T10:00:00.000Z', { actorId: staff }),
        row('2026-10-02T10:01:00.000Z', {
          action: 'http.access-denied',
          result: 'DENIED',
          resourceType: 'route',
          resourceId: 'GET /v1/admin/audit',
        }),
        row('2026-10-02T10:02:00.000Z', {
          actorType: 'SYSTEM',
          actorId: null,
          action: 'orders.expire',
        }),
        row('2026-10-02T10:03:00.000Z', {
          action: 'ordersx.cancel',
          resourceType: 'route',
        }),
        row('2026-10-01T23:59:59.999Z'),
        row('2026-10-03T00:00:00.000Z'),
      );

      expect(ids(await list({ actorId: staff }))).toEqual([mine.id]);
      expect(ids(await list({ actorTypes: ['SYSTEM', 'ANONYMOUS'] }))).toEqual([
        system.id,
      ]);
      expect(ids(await list({ action: 'orders.expire' }))).toEqual([system.id]);
      expect(ids(await list({ actionPrefix: 'orders.' }))).toEqual([
        late.id,
        system.id,
        mine.id,
        early.id,
      ]);
      expect(ids(await list({ resourceType: 'route' }))).toEqual([
        other.id,
        denied.id,
      ]);
      expect(ids(await list({ resourceId: 'GET /v1/admin/audit' }))).toEqual([
        denied.id,
      ]);
      expect(
        ids(await list({ resourceType: 'order', resourceId: 'order-1' })),
      ).toEqual([late.id, system.id, mine.id, early.id]);
      expect(ids(await list({ results: ['DENIED', 'FAILED'] }))).toEqual([
        denied.id,
      ]);
      expect(
        ids(
          await list({
            from: new Date('2026-10-02T10:01:00.000Z'),
            to: new Date('2026-10-02T10:03:00.000Z'),
          }),
        ),
      ).toEqual([other.id, system.id, denied.id]);
    });
  });

  describe('the archive (UC-AUD-03)', () => {
    const archive = () => cls.run(() => moduleRef.get(AuditArchive).run());

    const filesIn = async () =>
      (await readdir(directory)).filter((name) => name !== '.writing').sort();

    const linesOf = async (name: string) =>
      gunzipSync(await readFile(path.join(directory, name)))
        .toString('utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>);

    /** A record as its file keeps it: dates as ISO text. */
    const asLine = (entry: AuditEntryView) => ({
      ...entry,
      occurredAt: entry.occurredAt.toISOString(),
    });

    it('moves each whole UTC day before the retention to its file, and keeps the rest in the database', async () => {
      const first = await insert(
        row('2026-07-01T00:00:00.000Z', { reason: 'Motivo con ñ' }),
        row('2026-07-01T23:59:59.999Z', { changes: null, ip: null }),
      );
      // July 1 at 21:00 in Mexico: it belongs to July 2, a day of UTC.
      const second = await insert(row('2026-07-02T03:00:00.000Z'));
      const kept = await insert(
        row('2026-07-03T00:00:00.000Z'),
        row('2026-10-02T12:00:00.000Z'),
      );

      expect(await archive()).toEqual({
        archivedDays: 2,
        archivedEntries: 3,
        failedDays: 0,
        deletedFiles: 0,
      });

      expect(await filesIn()).toEqual([
        'audit-2026-07-01.jsonl.gz',
        'audit-2026-07-02.jsonl.gz',
      ]);
      expect(await linesOf('audit-2026-07-01.jsonl.gz')).toEqual(
        first.map(asLine),
      );
      expect(await linesOf('audit-2026-07-02.jsonl.gz')).toEqual(
        second.map(asLine),
      );
      expect(
        ids(await prisma.auditLog.findMany({ orderBy: { occurredAt: 'asc' } })),
      ).toEqual(ids(kept));

      expect(await archive()).toMatchObject({
        archivedDays: 0,
        archivedEntries: 0,
      });
      expect(await filesIn()).toHaveLength(2);
    });

    it('archives a day again in a new file, never replacing the one it has', async () => {
      const [restored] = await insert(row('2026-07-01T10:00:00.000Z'));
      await archive();
      const firstFile = await readFile(
        path.join(directory, 'audit-2026-07-01.jsonl.gz'),
      );
      // The record comes back, for example from a restored backup.
      await insert({ ...row('2026-07-01T10:00:00.000Z'), id: restored.id });
      const [late] = await insert(row('2026-07-01T11:00:00.000Z'));

      expect((await archive()).archivedEntries).toBe(2);

      expect(await filesIn()).toEqual([
        'audit-2026-07-01.2.jsonl.gz',
        'audit-2026-07-01.jsonl.gz',
      ]);
      expect(
        await readFile(path.join(directory, 'audit-2026-07-01.jsonl.gz')),
      ).toEqual(firstFile);
      expect(
        (await linesOf('audit-2026-07-01.2.jsonl.gz')).map(({ id }) => id),
      ).toEqual([restored.id, late.id]);
      expect(await prisma.auditLog.count()).toBe(0);
    });

    it('deletes nothing of a day that gets another record after it was exported, and archives it whole in the next run', async () => {
      const [exported] = await insert(row('2026-07-01T10:00:00.000Z'));
      const logs = moduleRef.get(ArchivableAuditLogs);
      const deleteDay = logs.deleteDay.bind(logs);
      let late: AuditEntryView | undefined;
      const spy = jest
        .spyOn(logs, 'deleteDay')
        .mockImplementationOnce(async (day) => {
          // Committed by another connection before the DELETE runs.
          [late] = await insert(row('2026-07-01T11:00:00.000Z'));
          return deleteDay(day);
        });
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

      expect((await archive()).failedDays).toBe(1);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(
        ids(await prisma.auditLog.findMany({ orderBy: { occurredAt: 'asc' } })),
      ).toEqual([exported.id, late!.id]);
      expect(await filesIn()).toEqual(['audit-2026-07-01.jsonl.gz']);

      expect(await archive()).toMatchObject({
        archivedEntries: 2,
        failedDays: 0,
      });
      expect(
        (await linesOf('audit-2026-07-01.2.jsonl.gz')).map(({ id }) => id),
      ).toEqual([exported.id, late!.id]);
      expect(await prisma.auditLog.count()).toBe(0);
    });

    it('reads a day of more than one batch from the last record of each, also among records of the same instant', async () => {
      const day = await insert(
        ...Array.from({ length: 1_001 }, () => row('2026-07-01T10:00:00.000Z')),
        row('2026-07-01T10:00:00.001Z'),
      );

      expect((await archive()).archivedEntries).toBe(1_002);

      expect(
        (await linesOf('audit-2026-07-01.jsonl.gz')).map(({ id }) => id),
      ).toEqual([...ids(day.slice(0, 1_001)).sort(), day[1_001].id]);
      expect(await prisma.auditLog.count()).toBe(0);
    });

    it('runs every day as the job audit.archive', async () => {
      await insert(row('2026-07-01T10:00:00.000Z'));

      await cls.run(() => moduleRef.get(AuditArchiveJob).run());

      expect(await filesIn()).toEqual(['audit-2026-07-01.jsonl.gz']);
    });

    it('deletes the files older than the archive retention, and what a run left half written', async () => {
      await rm(directory, { recursive: true, force: true });
      await insert(row('2026-07-01T10:00:00.000Z'));
      await archive();
      for (const name of [
        'audit-2024-10-02.jsonl.gz',
        'audit-2024-10-02.2.jsonl.gz',
        'audit-2024-10-03.jsonl.gz',
      ]) {
        await writeFile(path.join(directory, name), gzipSync(''));
      }
      await writeFile(
        path.join(directory, '.writing', '2026-07-02.abc.tmp'),
        'half written',
      );

      expect((await archive()).deletedFiles).toBe(2);

      expect(await filesIn()).toEqual([
        'audit-2024-10-03.jsonl.gz',
        'audit-2026-07-01.jsonl.gz',
      ]);
      expect(await readdir(directory)).not.toContain('.writing');
    });
  });
});
