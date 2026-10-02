import {
  type DomainEvent,
  eventMetadata,
} from '../../../shared-kernel/index.js';
import type { OrderId } from '../domain/order.js';

// The events of the life of an order that tell its buyer by email (ADR-0074, ADR-0143). They carry only the order:
// Notifications reads the rest with `OrderingFacade`. `OrderExpired` lives with the expiration, which is its use.

/** Published when an order is placed (UC-ORD-02). */
export interface OrderPlaced extends DomainEvent<'OrderPlaced'> {
  readonly orderId: OrderId;
}

/**
 * Published when an order becomes PAID, its stock confirmed (UC-ORD-08 and 09): with the captured payment, a late
 * payment that found stock, or the staff retrying the fulfillment. Never while it waits for stock (ADR-0074).
 */
export interface OrderPaid extends DomainEvent<'OrderPaid'> {
  readonly orderId: OrderId;
}

/** Published when the staff cancels an order (UC-ORD-07), saying whether its full refund started (ADR-0051). */
export interface OrderCancelled extends DomainEvent<'OrderCancelled'> {
  readonly orderId: OrderId;
  readonly refundStarted: boolean;
}

export function orderPlaced(orderId: OrderId, at: Date): OrderPlaced {
  return { ...eventMetadata('OrderPlaced', at), orderId };
}

export function orderPaid(orderId: OrderId, at: Date): OrderPaid {
  return { ...eventMetadata('OrderPaid', at), orderId };
}

export function orderCancelled(
  orderId: OrderId,
  refundStarted: boolean,
  at: Date,
): OrderCancelled {
  return { ...eventMetadata('OrderCancelled', at), orderId, refundStarted };
}
