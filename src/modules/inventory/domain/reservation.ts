import { type Id, InvalidValueError } from '../../../shared-kernel/index.js';
import type { VariantId } from './stock.js';

export type ReservationId = Id<'Reservation'>;

/** An order of Ordering, known here only by its ID (ADR-0005). */
export type OrderId = Id<'Order'>;

/** BR-INV-03: ACTIVE → COMMITTED | RELEASED | EXPIRED, once. */
export type ReservationStatus = 'ACTIVE' | 'COMMITTED' | 'RELEASED' | 'EXPIRED';

/** Units of a variant that an order or a cart asks for. */
export interface StockRequest {
  readonly variantId: VariantId;
  readonly quantity: number;
}

/** A reservation as its order needs it: until when it holds the stock. */
export interface ReservationReceipt {
  readonly reservationId: ReservationId;
  readonly orderId: OrderId;
  readonly expiresAt: Date;
}

/**
 * What confirming the reservation of an order did (UC-INV-06): it confirmed it now, it was already confirmed
 * (a payment event that comes twice), or the order has no active reservation, so Ordering applies ADR-0012.
 */
export type CommitOutcome = 'committed' | 'already-committed' | 'not-active';

/**
 * The requests with the same variant added up, in the order they first appear (ADR-0128).
 *
 * @throws InvalidValueError when a quantity is not a whole number above zero.
 */
export function mergedRequests(
  requests: readonly StockRequest[],
): StockRequest[] {
  const merged = new Map<VariantId, number>();
  for (const { variantId, quantity } of requests) {
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new InvalidValueError(
        'A request of stock asks for a whole number of units above zero',
      );
    }
    merged.set(variantId, (merged.get(variantId) ?? 0) + quantity);
  }
  return [...merged].map(([variantId, quantity]) => ({ variantId, quantity }));
}
