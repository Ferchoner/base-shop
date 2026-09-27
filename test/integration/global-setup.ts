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
 * Starts a throwaway PostgreSQL 18 container for the whole integration run (ADR-0090)
 * and exposes it through DATABASE_URL. Every run starts from an empty database.
 */
export default async function globalSetup(): Promise<void> {
  let container: StartedPostgreSqlContainer;
  try {
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  } catch (error) {
    throw new Error(
      'Integration tests need Docker running (T-105, ADR-0090). Start Docker Desktop and try again.',
      { cause: error },
    );
  }
  globalThis.__INTEGRATION_POSTGRES__ = container;
  process.env.DATABASE_URL = container.getConnectionUri();
}
