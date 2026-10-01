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
 * DomainEventPublisher of the application (ADR-0098). Events published inside a transaction wait until the
 * commit and are dispatched as one batch, in publish order; a rollback drops them, and so does undoing a nested
 * step (`TransactionManager.runNested`, ADR-0132) for the events published in it.
 */
@Injectable()
export class ClsDomainEventPublisher extends DomainEventPublisher {
  private readonly batches = new WeakMap<TransactionScope, DomainEvent[]>();

  constructor(private readonly dispatcher: DomainEventDispatcher) {
    super();
  }

  publish(...events: DomainEvent[]): void {
    const scope = currentTransactionScope();
    if (scope === undefined) {
      this.dispatcher.dispatchInBackground(events);
      return;
    }
    // One callback per publish, so an undone nested step discards exactly its events. The callbacks run one
    // after the other at the commit: the first starts the batch, and the dispatcher reads it on the next turn
    // of the event loop, when the rest have added theirs.
    scope.afterCommit(() => {
      const batch = this.batches.get(scope);
      if (batch !== undefined) {
        batch.push(...events);
        return;
      }
      const first = [...events];
      this.batches.set(scope, first);
      this.dispatcher.dispatchInBackground(first);
    });
  }
}
