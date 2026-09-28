import { Logger } from '@nestjs/common';
import { CLS_ID, ClsServiceManager } from 'nestjs-cls';
import { newId } from '../../shared-kernel/index.js';

const logger = new Logger('Jobs');

/**
 * Runs of scheduled jobs in this process (ADR-0101). Process-wide on purpose: the scheduler calls job
 * methods outside dependency injection, and the API runs as a single process (ADR-0029).
 */
const running = new Map<string, Promise<void>>();
let accepting = true;

/**
 * Runs one execution of a job:
 * - skips it, with a warning, while the previous run of the same job is still in progress;
 * - runs it in its own async context with a new id, so its logs can be told apart and transactions,
 *   events and the audit trail (actor SYSTEM) work as in a request;
 * - logs a failure and never rethrows it, so the scheduler keeps going.
 */
export async function runJob(name: string, work: () => unknown): Promise<void> {
  if (!accepting) return;
  if (running.has(name)) {
    logger.warn(`Job ${name} skipped: its previous run is still in progress`);
    return;
  }
  const run = execute(name, work);
  running.set(name, run);
  try {
    await run;
  } finally {
    running.delete(name);
  }
}

/** Lets jobs run again, for an application that starts. */
export function acceptJobRuns(): void {
  accepting = true;
}

/** Stops new runs and waits for the ones in progress, before the database disconnects. */
export async function stopJobRuns(): Promise<void> {
  accepting = false;
  await Promise.all(running.values());
}

async function execute(name: string, work: () => unknown): Promise<void> {
  const cls = ClsServiceManager.getClsService();
  await cls.run(async () => {
    cls.set(CLS_ID, newId());
    const startedAt = performance.now();
    logger.debug(`Job ${name} started`);
    try {
      await work();
      const elapsedMs = performance.now() - startedAt;
      logger.debug(`Job ${name} finished in ${elapsedMs.toFixed(0)} ms`);
    } catch (error) {
      logger.error(
        `Job ${name} failed`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  });
}
