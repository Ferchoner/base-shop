import { Global, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { DomainEventPublisher } from '../../shared-kernel/index.js';
import { ClsDomainEventPublisher } from './cls-domain-event-publisher.js';
import { DomainEventDispatcher } from './domain-event-dispatcher.js';
import { EventDeliveryJob } from './event-delivery.job.js';
import { EventOutbox } from './event-outbox.js';

/**
 * Domain events (ADR-0098, ADR-0150): the publisher port, the outbox that stores them with their change, the
 * dispatcher that finds handlers and the job that retries failed deliveries.
 */
@Global()
@Module({
  imports: [DiscoveryModule],
  providers: [
    DomainEventDispatcher,
    EventOutbox,
    EventDeliveryJob,
    { provide: DomainEventPublisher, useClass: ClsDomainEventPublisher },
  ],
  exports: [DomainEventPublisher],
})
export class EventsModule {}
