import type { Cart, CartId, CustomerId } from './cart.js';

/**
 * Persistence of carts. Every change runs in a transaction and works on locked rows (ADR-0131): the contract
 * sends no `version`, so two changes of one cart wait for each other instead of failing. An abstract class
 * rather than an interface, so it can be the dependency injection token without depending on NestJS.
 */
export abstract class CartRepository {
  /** The cart with this ID, as it is now, without locking it; `null` if it does not exist. */
  abstract find(id: CartId): Promise<Cart | null>;

  /** The active cart of the customer, without locking it; `null` without one. */
  abstract findActiveOf(customer: CustomerId): Promise<Cart | null>;

  /** The cart with this ID, locked until the transaction ends; `null` if it does not exist. */
  abstract lock(id: CartId): Promise<Cart | null>;

  /**
   * The active cart of the customer, locked; `null` without one. It first takes a lock of the customer, so
   * creating or adopting the customer's cart never races with another request of the same customer (BR-CRT-03).
   */
  abstract lockActiveOf(customer: CustomerId): Promise<Cart | null>;

  /** Saves a new cart. */
  abstract insert(cart: Cart, now: Date): Promise<void>;

  /** Writes what changed in the cart: its status, owner and activity, and the lines it touched. */
  abstract save(cart: Cart): Promise<void>;
}
