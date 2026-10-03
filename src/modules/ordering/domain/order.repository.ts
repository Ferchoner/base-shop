import type { CustomerId, Order, OrderId } from './order.js';
import type { PublicCode } from './public-code.js';

/** Whose orders: a customer's, or the guest orders with a contact email, already normalized (ADR-0067). */
export type OrdersOf =
  { readonly customerId: CustomerId } | { readonly guestEmail: string };

/**
 * Persistence of orders (DATABASE.md §8). An abstract class rather than an interface, so it can be the
 * dependency injection token without depending on NestJS.
 */
export abstract class OrderRepository {
  /**
   * Saves a new order with its lines and the first entry of its status history, in the transaction of the
   * caller.
   *
   * @returns false, writing nothing, when another order already has its public code (ADR-0049): the caller
   *   draws another one. The transaction stays usable.
   */
  abstract insert(order: Order): Promise<boolean>;

  /**
   * The order with this ID, its row locked until the transaction ends, so a staff action and a payment never
   * change it at the same time (ADR-0133); `null` if it does not exist.
   */
  abstract lock(id: OrderId): Promise<Order | null>;

  /** The order with this public code, locked like `lock`; `null` if no order has it. */
  abstract lockByPublicCode(code: PublicCode): Promise<Order | null>;

  /**
   * The orders of a buyer that were not anonymized, locked like `lock`, in the order of their IDs, so two
   * anonymizations of the same buyer wait for each other (ADR-0145). The second finds none of them anymore.
   */
  abstract lockOf(buyer: OrdersOf): Promise<Order[]>;

  /**
   * Up to `limit` PENDING_PAYMENT orders whose payment was due at `at`, the oldest due first (UC-ORD-10). They
   * are not locked: whoever expires one locks it and looks again.
   */
  abstract dueForExpiry(at: Date, limit: number): Promise<OrderId[]>;

  /**
   * Writes what changed in a locked order and one history entry per status change, and counts one more
   * version.
   *
   * @throws VersionConflictError when the saved version is not the one read.
   */
  abstract save(order: Order, now: Date): Promise<void>;
}
