import type { Order, OrderId } from './order.js';

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

  /**
   * Writes what changed in a locked order and one history entry per status change, and counts one more
   * version.
   *
   * @throws VersionConflictError when the saved version is not the one read.
   */
  abstract save(order: Order, now: Date): Promise<void>;
}
