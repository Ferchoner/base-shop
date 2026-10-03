import type { DomainEvent } from './domain-event.js';

/**
 * Publishes domain events to their handlers (ADR-0014, ADR-0098, ADR-0150). Inside `TransactionManager.run`, events
 * wait for the commit and are dropped on rollback; outside a transaction they go out right away. Either way, handlers
 * run in the background: when `publish` or `run` returns, their effects may not have happened yet (`API_SPEC.md`,
 * section 2.5).
 *
 * An abstract class rather than an interface, so it can be the dependency injection token without depending
 * on NestJS.
 */
export abstract class DomainEventPublisher {
  /**
   * Stores the events with the change, in the same transaction, and delivers them at least once to each handler:
   * one that fails is retried, so a handler may run more than once and must not mind. Events never carry personal
   * data: they are stored.
   */
  abstract publish(...events: DomainEvent[]): void;

  /**
   * Delivers the events once, without storing them: a failure, or the API stopping, loses their effects. Only for
   * events that carry personal data and whose loss does no harm, such as a request the person can repeat.
   */
  abstract publishVolatile(...events: DomainEvent[]): void;
}
