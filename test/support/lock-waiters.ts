import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';

/**
 * Waits until `count` sessions are blocked on a lock, or a few seconds pass, for tests that hold a row lock
 * to line up concurrent operations. It asks on its own connection, outside any transaction: inside one,
 * PostgreSQL answers `pg_stat_activity` from a snapshot taken on the first read, so the connection holding
 * the lock would never see sessions that start waiting later.
 */
export async function waitForLockWaiters(count: number): Promise<void> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const { rows } = await client.query<{ waiting: string }>(
        "SELECT count(*) AS waiting FROM pg_stat_activity WHERE wait_event_type = 'Lock'",
      );
      if (Number(rows[0].waiting) >= count) return;
      await sleep(100);
    }
  } finally {
    await client.end();
  }
}
