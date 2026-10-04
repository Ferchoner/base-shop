import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const MIGRATIONS = path.join(process.cwd(), 'prisma', 'migrations');

/** Every migration, in the order Prisma applies them: by the name of its folder. */
export function migrationNames(): string[] {
  return readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * A database of its own in the PostgreSQL of the tests, migrated by hand (T-300, ADR-0157), to test a migration that
 * fills columns of existing rows: migrate up to just before it, insert rows as they were then, apply it and check them.
 * The shared database of the tests, migrated from scratch, never has those rows. Each migration runs as Prisma runs
 * it: its whole SQL file at once.
 */
export class MigrationDatabase {
  private constructor(
    private readonly admin: pg.Client,
    /** Connected to this database, to insert the rows and read the result. */
    readonly client: pg.Client,
    private readonly name: string,
  ) {}

  static async create(): Promise<MigrationDatabase> {
    const url = new URL(process.env.DATABASE_URL ?? '');
    const admin = new pg.Client({ connectionString: url.toString() });
    await admin.connect();
    const name = `migration_${randomUUID().replaceAll('-', '')}`;
    await admin.query(`CREATE DATABASE "${name}"`);
    url.pathname = `/${name}`;
    const client = new pg.Client({ connectionString: url.toString() });
    await client.connect();
    return new MigrationDatabase(admin, client, name);
  }

  /** Applies, in order, every migration before `name`. */
  async migrateUpTo(name: string): Promise<void> {
    const names = migrationNames();
    const index = names.indexOf(name);
    if (index < 0) throw new Error(`There is no migration ${name}`);
    for (const earlier of names.slice(0, index)) await this.apply(earlier);
  }

  async apply(name: string): Promise<void> {
    await this.client.query(
      readFileSync(path.join(MIGRATIONS, name, 'migration.sql'), 'utf8'),
    );
  }

  async drop(): Promise<void> {
    await this.client.end();
    await this.admin.query(`DROP DATABASE "${this.name}" WITH (FORCE)`);
    await this.admin.end();
  }
}
