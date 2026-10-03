import type { CustomerId } from '../domain/cart.js';

/**
 * The carts of a customer being anonymized (UC-IAM-19, ADR-0067). An abstract class rather than an interface, so it
 * can be the dependency injection token without depending on NestJS.
 */
export abstract class CustomerCarts {
  /**
   * Deletes every cart of the customer, in any status, with their lines and the guest carts merged into them, in the
   * transaction of the caller. It takes the lock of the customer's carts first, as every change of them does
   * (ADR-0131), so a change already running ends before.
   */
  abstract deleteOf(customer: CustomerId): Promise<void>;
}
