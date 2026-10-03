import { CronExpression } from '@nestjs/schedule';
import { TokenCleanupJob } from '../../modules/identity-access/infrastructure/token-cleanup.job.js';
import { AccessTokenCleanupJob } from '../../modules/ordering/infrastructure/access-token-cleanup.job.js';
import { WebhookEventCleanupJob } from '../../modules/payments/infrastructure/webhook-event-cleanup.job.js';
import { GuestCartCleanupJob } from '../../modules/shopping/infrastructure/guest-cart-cleanup.job.js';
import { DeliveredEventCleanupJob } from '../events/delivered-event-cleanup.job.js';
import { IdempotencyCleanupJob } from '../http/idempotency/idempotency-cleanup.job.js';
import type { IdempotencyStore } from '../http/idempotency/idempotency.store.js';
import { JOBS_TIME_ZONE } from './scheduled-job.decorator.js';

const cronOf = (method: object) =>
  Reflect.getMetadata('SCHEDULE_CRON_OPTIONS', method) as unknown;

/** The jobs of the daily cleanup, one per owner of the tables (UC-SYS-01, ADR-0029, ADR-0144). */
describe('Daily cleanup jobs', () => {
  it.each([
    ['identity.cleanup-tokens', TokenCleanupJob.prototype.run],
    ['shopping.cleanup-guest-carts', GuestCartCleanupJob.prototype.run],
    ['ordering.cleanup-access-tokens', AccessTokenCleanupJob.prototype.run],
    ['payments.cleanup-webhook-events', WebhookEventCleanupJob.prototype.run],
    ['platform.cleanup-idempotency-keys', IdempotencyCleanupJob.prototype.run],
    ['platform.cleanup-events', DeliveredEventCleanupJob.prototype.run],
  ])('runs %s every day at 3:00, Mexico time', (name, run) => {
    expect(cronOf(run)).toMatchObject({
      cronTime: CronExpression.EVERY_DAY_AT_3AM,
      timeZone: JOBS_TIME_ZONE,
      name,
    });
  });

  it('runs the cleanup of each owner on each run', async () => {
    const runs: string[] = [];
    const cleanup = (name: string) => ({
      run: () => {
        runs.push(name);
        return Promise.resolve(0);
      },
    });

    await new TokenCleanupJob(cleanup('tokens') as never).run();
    await new GuestCartCleanupJob(cleanup('carts') as never).run();
    await new AccessTokenCleanupJob(cleanup('access links') as never).run();
    await new WebhookEventCleanupJob(cleanup('webhooks') as never).run();
    const store = {
      deleteExpired: (now: Date, limit: number) => {
        runs.push(`keys ${limit}`);
        return Promise.resolve(0);
      },
    } as unknown as IdempotencyStore;
    await new IdempotencyCleanupJob(store, { now: () => new Date() }).run();
    await new DeliveredEventCleanupJob(cleanup('events') as never).run();

    expect(runs).toEqual([
      'tokens',
      'carts',
      'access links',
      'webhooks',
      'keys 1000',
      'events',
    ]);
  });
});
