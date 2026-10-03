import type { Order } from '../domain/order.js';

/**
 * The responses kept for the idempotency of placing an order (ADR-0063, ADR-0099), which repeat its contact email and
 * address for 24 hours. An abstract class rather than an interface, so it can be the dependency injection token
 * without depending on NestJS.
 */
export abstract class PlacementResponses {
  /**
   * Forgets the responses kept for whoever placed these orders: the customer, or the cart of a guest order. It runs
   * outside the transaction of the caller, and forgetting twice changes nothing.
   */
  abstract forgetOf(orders: readonly Order[]): Promise<void>;
}
