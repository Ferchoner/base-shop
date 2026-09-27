import type { DomainEvent } from './domain-event.js';

/**
 * Publishes domain events to the handlers of other contexts (ADR-0014, ADR-0098). Inside
 * `TransactionManager.run`, events wait for the commit and are dropped on rollback; outside a transaction
 * they go out right away. Either way, handlers run in the background: when `publish` or `run` returns, their
 * effects may not have happened yet (`API_SPEC.md`, section 2.5).
 *
 * An abstract class rather than an interface, so it can be the dependency injection token without depending
 * on NestJS.
 */
export abstract class DomainEventPublisher {
  abstract publish(...events: DomainEvent[]): void;
}
