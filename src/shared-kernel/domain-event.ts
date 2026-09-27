import { type Id, newId } from './id.js';

/**
 * Fields every domain event carries (ADR-0014, ADR-0094). Each event extends it with its own data:
 *
 * ```ts
 * interface PaymentCaptured extends DomainEvent<'PaymentCaptured'> {
 *   readonly paymentId: PaymentId;
 *   readonly orderId: OrderId;
 * }
 * ```
 *
 * Events are dispatched in process after the commit (T-116); `eventId` lets handlers ignore an event they
 * already processed.
 */
export interface DomainEvent<TType extends string = string> {
  readonly eventId: Id<'DomainEvent'>;
  /** Event name as in `DOMAIN_MODEL.md`, such as `PaymentCaptured`. */
  readonly eventType: TType;
  readonly occurredAt: Date;
}

/** The common fields of a new event; `occurredAt` usually comes from the Clock. */
export function eventMetadata<TType extends string>(
  eventType: TType,
  occurredAt: Date,
): DomainEvent<TType> {
  return { eventId: newId(), eventType, occurredAt };
}
