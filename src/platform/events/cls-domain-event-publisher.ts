import { Injectable } from '@nestjs/common';
import {
  Clock,
  type DomainEvent,
  DomainEventPublisher,
} from '../../shared-kernel/index.js';
import {
  currentTransactionScope,
  type TransactionScope,
} from '../persistence/transaction-scope.js';
import { DomainEventDispatcher } from './domain-event-dispatcher.js';
import { EventOutbox, type EventsToStore } from './event-outbox.js';

/** An event waiting for the commit, and whether it was stored. */
interface PendingEvent {
  readonly event: DomainEvent;
  readonly stored: boolean;
}

/**
 * DomainEventPublisher of the application (ADR-0098, ADR-0150).
 * - `publish` stores the events in the transaction, after its work and before the commit, with one delivery per
 *   handler (EventOutbox); a rollback drops them. Outside a transaction it stores them in one of their own, in the
 *   background.
 * - `publishVolatile` keeps them only in memory.
 *
 * Either way they are dispatched after the commit as one batch, in publish order, and undoing a nested step
 * (`TransactionManager.runNested`, ADR-0132) drops the events published in it.
 */
@Injectable()
export class ClsDomainEventPublisher extends DomainEventPublisher {
  private readonly batches = new WeakMap<TransactionScope, PendingEvent[]>();

  constructor(
    private readonly dispatcher: DomainEventDispatcher,
    private readonly outbox: EventOutbox,
    private readonly clock: Clock,
  ) {
    super();
  }

  publish(...events: DomainEvent[]): void {
    const scope = currentTransactionScope();
    if (scope === undefined) {
      this.dispatcher.runInBackground(async () => {
        await this.outbox.saveAlone(this.toStore(events), this.clock.now());
        await this.dispatcher.deliver(events);
      });
      return;
    }
    scope.beforeCommit(() =>
      this.outbox.save(this.toStore(events), this.clock.now()),
    );
    this.afterCommit(
      scope,
      events.map((event) => ({ event, stored: true })),
    );
  }

  publishVolatile(...events: DomainEvent[]): void {
    const scope = currentTransactionScope();
    if (scope === undefined) {
      this.dispatcher.dispatchInBackground(events);
      return;
    }
    this.afterCommit(
      scope,
      events.map((event) => ({ event, stored: false })),
    );
  }

  private toStore(events: readonly DomainEvent[]): EventsToStore {
    return events.map((event) => ({
      event,
      handlers: this.dispatcher.handlerNames(event.eventType),
    }));
  }

  /**
   * One callback per publish, so an undone nested step discards exactly its events. The callbacks run one after the
   * other at the commit: the first starts the batch, and the background work reads it on the next turn of the event
   * loop, when the rest have added theirs.
   */
  private afterCommit(
    scope: TransactionScope,
    pending: readonly PendingEvent[],
  ): void {
    scope.afterCommit(() => {
      const batch = this.batches.get(scope);
      if (batch !== undefined) {
        batch.push(...pending);
        return;
      }
      const first = [...pending];
      this.batches.set(scope, first);
      this.dispatcher.runInBackground(() => this.dispatch(first));
    });
  }

  /** Each run of events keeps its kind, and all of them go out in publish order. */
  private async dispatch(batch: readonly PendingEvent[]): Promise<void> {
    let start = 0;
    while (start < batch.length) {
      const stored = batch[start].stored;
      let end = start;
      while (end < batch.length && batch[end].stored === stored) end += 1;
      const events = batch.slice(start, end).map(({ event }) => event);
      await (stored
        ? this.dispatcher.deliver(events)
        : this.dispatcher.dispatch(events));
      start = end;
    }
  }
}
