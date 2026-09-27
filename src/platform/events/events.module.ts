import { Global, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { DomainEventPublisher } from '../../shared-kernel/index.js';
import { ClsDomainEventPublisher } from './cls-domain-event-publisher.js';
import { DomainEventDispatcher } from './domain-event-dispatcher.js';

/** In-process domain events (ADR-0014, ADR-0098): the publisher port and the dispatcher that finds handlers. */
@Global()
@Module({
  imports: [DiscoveryModule],
  providers: [
    DomainEventDispatcher,
    { provide: DomainEventPublisher, useClass: ClsDomainEventPublisher },
  ],
  exports: [DomainEventPublisher],
})
export class EventsModule {}
