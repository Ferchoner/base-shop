import type { Order } from './order.js';

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
}
