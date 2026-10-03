import { CronExpression } from '@nestjs/schedule';
import { JOBS_TIME_ZONE } from '../jobs/scheduled-job.decorator.js';
import type { DomainEventDispatcher } from './domain-event-dispatcher.js';
import { EventDeliveryJob } from './event-delivery.job.js';

describe('EventDeliveryJob (ADR-0150)', () => {
  it('retries the due deliveries every minute, Mexico time', async () => {
    const runs: string[] = [];
    const dispatcher = {
      deliverDue: () => {
        runs.push('deliverDue');
        return Promise.resolve({ delivered: 0, failed: 0, abandoned: 0 });
      },
    } as unknown as DomainEventDispatcher;

    await new EventDeliveryJob(dispatcher).run();

    expect(runs).toEqual(['deliverDue']);
    expect(
      Reflect.getMetadata(
        'SCHEDULE_CRON_OPTIONS',
        EventDeliveryJob.prototype.run,
      ),
    ).toMatchObject({
      cronTime: CronExpression.EVERY_MINUTE,
      timeZone: JOBS_TIME_ZONE,
      name: 'platform.deliver-events',
    });
  });
});
