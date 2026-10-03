import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/environment.js';
import {
  DELIVERED_EVENT_RETENTION_DAYS,
  DeliveredEventCleanup,
} from './delivered-event-cleanup.js';
import { DeliveredEventCleanupJob } from './delivered-event-cleanup.job.js';
import { EventDeliveriesController } from './event-deliveries.controller.js';
import { EventDeliveries } from './event-deliveries.js';

/**
 * The administration of the outbox (T-109 part b, ADR-0150): the staff lists and retries deliveries, and a daily job
 * deletes the delivered events. Apart from EventsModule, which the tests of the bus use without a database or an
 * audit trail.
 */
@Module({
  controllers: [EventDeliveriesController],
  providers: [
    EventDeliveries,
    DeliveredEventCleanup,
    DeliveredEventCleanupJob,
    {
      provide: DELIVERED_EVENT_RETENTION_DAYS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        config.get('DELIVERED_EVENT_RETENTION_DAYS', { infer: true }),
    },
  ],
})
export class EventDeliveriesModule {}
