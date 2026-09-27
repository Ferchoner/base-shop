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

  it('starts every run with an empty database', async () => {
    const { rows } = await client.query<{ tables: string }>(
      `SELECT count(*) AS tables
         FROM information_schema.tables
        WHERE table_schema NOT IN ('pg_catalog', 'information_schema')`,
    );

    expect(Number(rows[0].tables)).toBe(0);
  });
});
