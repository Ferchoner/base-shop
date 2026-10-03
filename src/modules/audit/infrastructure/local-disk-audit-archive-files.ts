import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream, createWriteStream } from 'node:fs';
import { link, mkdir, open, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { StringDecoder } from 'node:string_decoder';
import { createGunzip, createGzip } from 'node:zlib';
import { Inject, Injectable } from '@nestjs/common';
import {
  type ArchiveDraft,
  AuditArchiveFiles,
  type UtcDay,
} from '../application/audit-archive.js';
import type { AuditEntryView } from '../application/audit-entries.js';

/** Folder of the files being written, inside the archive folder so keeping one stays on one disk. */
export const WRITING_FOLDER = '.writing';

/** `audit-2026-07-01.jsonl.gz`, and `audit-2026-07-01.2.jsonl.gz` for a second file of the day. */
const ARCHIVE_FILE = /^audit-(\d{4}-\d{2}-\d{2})(?:\.([1-9]\d*))?\.jsonl\.gz$/;

const UTC_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Where the archive lives (`AUDIT_ARCHIVE_DIR`): a private folder, never served (ADR-0037, ADR-0146). */
export interface AuditArchiveSettings {
  readonly directory: string;
}

export const AUDIT_ARCHIVE_SETTINGS = Symbol('AUDIT_ARCHIVE_SETTINGS');

/**
 * The archive of the audit trail on the server's disk (ADR-0037, ADR-0146): one record per line, as JSON, compressed
 * with gzip. A file is written in `.writing/`, forced to disk and read back, and only then linked to its final name,
 * which never replaces another file. Folders are private (0700) and files readable only by the API (0600). In
 * Docker, the folder must be a persistent volume, and it belongs in the backups.
 */
@Injectable()
export class LocalDiskAuditArchiveFiles extends AuditArchiveFiles {
  private readonly root: string;

  constructor(@Inject(AUDIT_ARCHIVE_SETTINGS) settings: AuditArchiveSettings) {
    super();
    this.root = path.resolve(settings.directory);
  }

  async discardUnfinished(): Promise<void> {
    await rm(path.join(this.root, WRITING_FOLDER), {
      recursive: true,
      force: true,
    });
  }

  async start(day: UtcDay): Promise<ArchiveDraft> {
    if (!UTC_DAY.test(day)) throw new Error(`Not a UTC day: ${day}`);
    const writing = path.join(this.root, WRITING_FOLDER);
    await mkdir(writing, { recursive: true, mode: 0o700 });
    return new DiskArchiveDraft(
      this.root,
      day,
      path.join(writing, `${day}.${randomUUID()}.tmp`),
    );
  }

  async deleteBefore(day: UtcDay): Promise<number> {
    let names: string[];
    try {
      names = await readdir(this.root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
      throw error;
    }
    let deleted = 0;
    for (const name of names) {
      const fileDay = ARCHIVE_FILE.exec(name)?.[1];
      if (fileDay !== undefined && fileDay < day) {
        await rm(path.join(this.root, name), { force: true });
        deleted += 1;
      }
    }
    return deleted;
  }
}

class DiskArchiveDraft implements ArchiveDraft {
  private readonly gzip = createGzip();
  private readonly written: Promise<void>;

  constructor(
    private readonly root: string,
    private readonly day: UtcDay,
    private readonly temporary: string,
  ) {
    this.written = pipeline(
      this.gzip,
      createWriteStream(temporary, { flags: 'wx', mode: 0o600 }),
    );
    // Awaited by close() or discard(); this keeps a failure before then from being unhandled.
    this.written.catch(() => undefined);
  }

  async append(entries: readonly AuditEntryView[]): Promise<void> {
    const lines = entries.map((entry) => `${JSON.stringify(entry)}\n`);
    if (!this.gzip.write(lines.join(''))) await once(this.gzip, 'drain');
  }

  async close(): Promise<string[]> {
    this.gzip.end();
    await this.written;
    const file = await open(this.temporary, 'r+');
    try {
      await file.sync();
    } finally {
      await file.close();
    }
    return idsIn(this.temporary);
  }

  async keep(): Promise<string> {
    for (let copy = 1; ; copy += 1) {
      const name = `audit-${this.day}${copy === 1 ? '' : `.${copy}`}.jsonl.gz`;
      try {
        // A link fails when the name is taken, so a file of the archive is never replaced.
        await link(this.temporary, path.join(this.root, name));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
        throw error;
      }
      await rm(this.temporary, { force: true });
      await syncFolder(this.root);
      return name;
    }
  }

  async discard(): Promise<void> {
    this.gzip.destroy();
    await this.written.catch(() => undefined);
    // A kept file has its own name: this only deletes the one being written.
    await rm(this.temporary, { force: true });
  }
}

/** The IDs of the records of a file, in their order, read back decompressed. */
async function idsIn(file: string): Promise<string[]> {
  const ids: string[] = [];
  await pipeline(
    createReadStream(file),
    createGunzip(),
    async (chunks: AsyncIterable<Buffer>) => {
      const decoder = new StringDecoder('utf8');
      let rest = '';
      for await (const chunk of chunks) {
        const lines = (rest + decoder.write(chunk)).split('\n');
        rest = lines.pop() ?? '';
        ids.push(...lines.map(idOf));
      }
      rest += decoder.end();
      if (rest !== '') ids.push(idOf(rest));
    },
  );
  return ids;
}

function idOf(line: string): string {
  const { id } = JSON.parse(line) as { id?: unknown };
  if (typeof id !== 'string') throw new Error('A line of the file has no ID');
  return id;
}

/** Forces a new name in the folder to disk. Windows cannot open a folder for it; NTFS keeps the name in its journal. */
async function syncFolder(folder: string): Promise<void> {
  if (process.platform === 'win32') return;
  const handle = await open(folder, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
