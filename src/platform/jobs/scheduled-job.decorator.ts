import { Cron } from '@nestjs/schedule';
import { runJob } from './job-runner.js';

/** Every cron expression is read in Mexico time, whatever the time zone of the server (ADR-0029). */
export const JOBS_TIME_ZONE = 'America/Mexico_City';

/**
 * Marks a method of a provider as a scheduled job (ADR-0029, ADR-0101). The job is an entry point in the
 * infrastructure layer: it calls one use case, which processes in batches with one transaction per item
 * and is idempotent. Runs never overlap, failures are logged, and each run has its own async context.
 *
 * ```ts
 * @ScheduledJob('inventory.expire-reservations', CronExpression.EVERY_MINUTE)
 * async run(): Promise<void> {
 *   await this.expireReservations.execute();
 * }
 * ```
 */
export function ScheduledJob(name: string, cronTime: string): MethodDecorator {
  return (target, key, descriptor) => {
    const job = descriptor.value as unknown as (...args: unknown[]) => unknown;
    const wrapped = function (this: unknown): Promise<void> {
      return runJob(name, () => job.call(this));
    };
    // @Cron keeps its metadata on the function it receives, so it must see the wrapped one.
    descriptor.value = wrapped as unknown as typeof descriptor.value;
    return Cron(cronTime, { name, timeZone: JOBS_TIME_ZONE })(
      target,
      key,
      descriptor,
    );
  };
}
