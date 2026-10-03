import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { AuditEntryView } from '../application/audit-entries.js';
import {
  LocalDiskAuditArchiveFiles,
  WRITING_FOLDER,
} from './local-disk-audit-archive-files.js';

const POSIX = process.platform !== 'win32';

const entry = (
  id: string,
  changes: AuditEntryView['changes'] = null,
): AuditEntryView => ({
  id,
  occurredAt: new Date('2026-07-01T12:00:00.000Z'),
  actorType: 'USER',
  actorId: '01a0f000-0000-7000-8000-999999999999',
  action: 'customers.suspend',
  resourceType: 'user',
  resourceId: 'user-1',
  result: 'SUCCESS',
  correlationId: 'correlation-1',
  ip: '203.0.113.7',
  userAgent: 'Mozilla/5.0',
  changes,
  reason: 'Solicitud ARCO-2026-0042 — ñandú',
});

/** The archive of the audit trail on a real disk, in a temporary folder (ADR-0037, ADR-0146). */
describe('LocalDiskAuditArchiveFiles', () => {
  let parent: string;
  let directory: string;
  let files: LocalDiskAuditArchiveFiles;

  beforeEach(async () => {
    parent = await mkdtemp(path.join(tmpdir(), 'base-shop-audit-'));
    directory = path.join(parent, 'audit');
    files = new LocalDiskAuditArchiveFiles({ directory });
  });

  afterEach(async () => {
    await rm(parent, { recursive: true, force: true });
  });

  const linesOf = async (name: string) =>
    gunzipSync(await readFile(path.join(directory, name)))
      .toString('utf8')
      .split('\n');

  const writing = async () =>
    readdir(path.join(directory, WRITING_FOLDER)).catch(() => []);

  it('writes one record per line as JSON with gzip, reads back its IDs in order, and keeps it under the name of its day', async () => {
    const draft = await files.start('2026-07-01');
    const first = entry('a1', { status: { from: 'ACTIVE', to: 'SUSPENDED' } });
    await draft.append([first, entry('a2')]);
    await draft.append([entry('a3')]);

    expect(await draft.close()).toEqual(['a1', 'a2', 'a3']);
    expect(await draft.keep()).toBe('audit-2026-07-01.jsonl.gz');

    const lines = await linesOf('audit-2026-07-01.jsonl.gz');
    expect(lines).toHaveLength(4);
    expect(lines[3]).toBe('');
    expect(JSON.parse(lines[0])).toEqual({
      ...first,
      occurredAt: '2026-07-01T12:00:00.000Z',
    });
    expect(await readdir(directory)).toEqual([
      WRITING_FOLDER,
      'audit-2026-07-01.jsonl.gz',
    ]);
    expect(await writing()).toEqual([]);
  });

  it('reads back records whose text is split between chunks of the file', async () => {
    const draft = await files.start('2026-07-01');
    const ids = Array.from({ length: 3_000 }, (_, index) => `id-${index}`);
    await draft.append(ids.map((id) => entry(id)));

    expect(await draft.close()).toEqual(ids);
  });

  it('never replaces a file: another one of the same day takes the next number', async () => {
    for (const ids of [['a1'], ['b1', 'b2'], ['c1']]) {
      const draft = await files.start('2026-07-01');
      await draft.append(ids.map((id) => entry(id)));
      await draft.close();
      await draft.keep();
    }

    expect((await readdir(directory)).sort()).toEqual([
      WRITING_FOLDER,
      'audit-2026-07-01.2.jsonl.gz',
      'audit-2026-07-01.3.jsonl.gz',
      'audit-2026-07-01.jsonl.gz',
    ]);
    expect(
      (await linesOf('audit-2026-07-01.jsonl.gz')).filter(Boolean),
    ).toHaveLength(1);
    expect(
      (await linesOf('audit-2026-07-01.2.jsonl.gz')).filter(Boolean),
    ).toHaveLength(2);
  });

  it('discards a file being written, before or after closing it, and twice', async () => {
    const open = await files.start('2026-07-01');
    await open.append([entry('a1')]);
    const closed = await files.start('2026-07-02');
    await closed.append([entry('b1')]);
    await closed.close();

    await open.discard();
    await closed.discard();
    await closed.discard();

    expect(await writing()).toEqual([]);
    expect(await readdir(directory)).toEqual([WRITING_FOLDER]);
  });

  it('keeps a kept file when the draft is discarded afterwards', async () => {
    const draft = await files.start('2026-07-01');
    await draft.append([entry('a1')]);
    await draft.close();
    await draft.keep();

    await draft.discard();

    expect(await readdir(directory)).toContain('audit-2026-07-01.jsonl.gz');
  });

  it('deletes what a run left half written, and only that', async () => {
    const draft = await files.start('2026-07-01');
    await draft.append([entry('a1')]);
    await draft.close();
    await draft.keep();
    await files.start('2026-07-02');

    await files.discardUnfinished();
    await files.discardUnfinished();

    expect(await readdir(directory)).toEqual(['audit-2026-07-01.jsonl.gz']);
  });

  it('deletes the files of the days before a day, all the files of each, and nothing else', async () => {
    await mkdir(directory, { recursive: true });
    const names = [
      'audit-2024-07-01.jsonl.gz',
      'audit-2024-07-01.2.jsonl.gz',
      'audit-2024-07-02.jsonl.gz',
      'audit-2024-07-03.jsonl.gz',
      'audit-2024-07-03.2.jsonl.gz',
      'audit-2024-06-30.0.jsonl.gz',
      'audit-2024-06-30.jsonl',
      'notes-2024-06-30.jsonl.gz',
      'README.txt',
    ];
    for (const name of names) {
      await writeFile(path.join(directory, name), gzipSync('{}\n'));
    }

    expect(await files.deleteBefore('2024-07-03')).toBe(3);

    expect((await readdir(directory)).sort()).toEqual([
      'README.txt',
      'audit-2024-06-30.0.jsonl.gz',
      'audit-2024-06-30.jsonl',
      'audit-2024-07-03.2.jsonl.gz',
      'audit-2024-07-03.jsonl.gz',
      'notes-2024-06-30.jsonl.gz',
    ]);
  });

  it('deletes no file of a folder that does not exist yet', async () => {
    expect(await files.deleteBefore('2026-07-01')).toBe(0);
  });

  it('refuses a day of another shape before touching the disk', async () => {
    await expect(files.start('../2026-07-01')).rejects.toThrow(
      'Not a UTC day: ../2026-07-01',
    );
    await expect(readdir(directory)).rejects.toThrow();
  });

  (POSIX ? it : it.skip)(
    'keeps the folders private and the files readable only by the API',
    async () => {
      const draft = await files.start('2026-07-01');
      await draft.append([entry('a1')]);
      await draft.close();
      await draft.keep();

      expect((await stat(directory)).mode & 0o777).toBe(0o700);
      expect(
        (await stat(path.join(directory, WRITING_FOLDER))).mode & 0o777,
      ).toBe(0o700);
      expect(
        (await stat(path.join(directory, 'audit-2026-07-01.jsonl.gz'))).mode &
          0o777,
      ).toBe(0o600);
    },
  );
});
