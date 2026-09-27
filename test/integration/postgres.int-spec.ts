import { readdirSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

/** Smoke test for the integration test infrastructure (T-105): a real PostgreSQL 18, no mocks. */
describe('PostgreSQL for integration tests', () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  it('runs against a real PostgreSQL 18 server', async () => {
    const { rows } = await client.query<{ server_version_num: string }>(
      'SHOW server_version_num',
    );
    const version = Number(rows[0].server_version_num);

    expect(version).toBeGreaterThanOrEqual(180000);
    expect(version).toBeLessThan(190000);
  });

  it('starts every run from a fresh database with every migration applied', async () => {
    const migrationFolders = readdirSync(
      path.join(process.cwd(), 'prisma', 'migrations'),
      { withFileTypes: true },
    ).filter((entry) => entry.isDirectory());

    const { rows } = await client.query<{ applied: string; total: string }>(
      `SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS applied,
              count(*) AS total
         FROM _prisma_migrations`,
    );

    expect(Number(rows[0].total)).toBe(migrationFolders.length);
    expect(Number(rows[0].applied)).toBe(migrationFolders.length);
  });
});
