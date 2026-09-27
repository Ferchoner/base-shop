// Jest loads this file with Node's own module loader (not Jest's), so it must not import local files.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';

declare global {
  var __INTEGRATION_POSTGRES__: StartedPostgreSqlContainer | undefined;
}

/** Same major version as every other environment (ADR-0025). */
const POSTGRES_IMAGE = 'postgres:18';

/**
 * Starts a throwaway PostgreSQL 18 container for the whole run (ADR-0090), applies every
 * migration from scratch (ADR-0091) and exposes the database through DATABASE_URL.
 * Used by the integration and end-to-end suites.
 */
export default async function globalSetup(): Promise<void> {
  let container: StartedPostgreSqlContainer;
  try {
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  } catch (error) {
    throw new Error(
      'Integration and e2e tests need Docker running (ADR-0090). Start Docker Desktop and try again.',
      { cause: error },
    );
  }
  globalThis.__INTEGRATION_POSTGRES__ = container;
  const databaseUrl = container.getConnectionUri();
  process.env.DATABASE_URL = databaseUrl;

  const prismaCli = path.join(
    process.cwd(),
    'node_modules',
    'prisma',
    'build',
    'index.js',
  );
  const migration = spawnSync(
    process.execPath,
    [prismaCli, 'migrate', 'deploy'],
    {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      encoding: 'utf8',
    },
  );
  if (migration.status !== 0) {
    await container.stop();
    throw new Error(
      `prisma migrate deploy failed:\n${migration.stdout}${migration.stderr}`,
    );
  }
}
