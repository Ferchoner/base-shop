// Shared kernel (ADR-0003, ADR-0088, ADR-0094): pure TypeScript used by every layer of every context.
export { Clock } from './clock.js';
export {
  DomainError,
  type DomainErrorCategory,
  InvalidValueError,
} from './domain-error.js';
export { type DomainEvent, eventMetadata } from './domain-event.js';
export { DomainEventPublisher } from './domain-event-publisher.js';
export { type Id, newCredentialId, newId, toId } from './id.js';
export { type Currency, MAX_MONEY_AMOUNT, Money } from './money.js';
export { TransactionManager } from './transaction-manager.js';
