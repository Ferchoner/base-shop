import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { ScheduledJob } from '../jobs/scheduled-job.decorator.js';
import { DomainEventDispatcher } from './domain-event-dispatcher.js';

/**
 * Every minute, the deliveries of stored events that failed, or never ran because the API stopped after the commit,
 * are tried again (ADR-0150). With several instances, each delivery is taken by one of them.
 */
@Injectable()
export class EventDeliveryJob {
  constructor(private readonly dispatcher: DomainEventDispatcher) {}

  @ScheduledJob('platform.deliver-events', CronExpression.EVERY_MINUTE)
  async run(): Promise<void> {
    await this.dispatcher.deliverDue();
  }
}
