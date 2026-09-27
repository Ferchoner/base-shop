import { Injectable } from '@nestjs/common';
import {
  type DomainEvent,
  DomainEventPublisher,
} from '../../shared-kernel/index.js';
import {
  currentTransactionScope,
  type TransactionScope,
} from '../persistence/transaction-scope.js';
import { DomainEventDispatcher } from './domain-event-dispatcher.js';

/**
 * DomainEventPublisher of the application (ADR-0098). Events published inside a transaction wait in one
 * queue per transaction, dispatched in publish order after the commit; a rollback drops them.
 */
@Injectable()
export class ClsDomainEventPublisher extends DomainEventPublisher {
  private readonly queues = new WeakMap<TransactionScope, DomainEvent[]>();

  constructor(private readonly dispatcher: DomainEventDispatcher) {
    super();
  }

  publish(...events: DomainEvent[]): void {
    const scope = currentTransactionScope();
    if (scope === undefined) {
      this.dispatcher.dispatchInBackground(events);
      return;
    }
    let queue = this.queues.get(scope);
    if (queue === undefined) {
      const newQueue: DomainEvent[] = [];
      this.queues.set(scope, newQueue);
      scope.afterCommit(() => this.dispatcher.dispatchInBackground(newQueue));
      queue = newQueue;
    }
    queue.push(...events);
  }
}
