import { Injectable } from '@nestjs/common';
import {
  Clock,
  newCredentialId,
  NotFoundError,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import {
  Cart,
  type CartId,
  type CustomerId,
  type VariantId,
} from '../domain/cart.js';
import {
  CartNotActiveError,
  VariantNotSellableError,
} from '../domain/cart-errors.js';
import { CartRepository } from '../domain/cart.repository.js';
import { CartCatalog, CartPrices } from './cart-ports.js';

/** Whose cart a request changes: a guest cart, by its ID, or the active cart of the signed-in customer. */
export type CartTarget =
  { readonly guestCartId: CartId } | { readonly customerId: CustomerId };

/**
 * Changes of carts (UC-CRT-01 to 04 and 06, ADR-0059, ADR-0131). Each runs in a transaction on the locked cart,
 * so simultaneous changes wait for each other and a line never passes 30 units. The routes of a guest cart only
 * reach carts without an owner: knowing the ID of a customer's cart gives no access to it.
 */
@Injectable()
export class Carts {
  constructor(
    private readonly carts: CartRepository,
    private readonly catalog: CartCatalog,
    private readonly prices: CartPrices,
    private readonly transactions: TransactionManager,
    private readonly clock: Clock,
  ) {}

  /** A new empty guest cart with a random ID, its only credential (UC-CRT-01). */
  createGuestCart(): Promise<CartId> {
    return this.transactions.run(async () => {
      const now = this.clock.now();
      const cart = Cart.open(newCredentialId<'Cart'>(), null, now);
      await this.carts.insert(cart, now);
      return cart.id;
    });
  }

  /**
   * Adds units of a sellable variant (UC-CRT-02). A customer's first line opens the customer's cart.
   *
   * @returns the cart, and whether this call created it.
   * @throws NotFoundError for a guest cart that does not exist or has an owner; VariantNotSellableError;
   *   CartNotActiveError, LineQuantityError or CartLineLimitError.
   */
  addLine(
    target: CartTarget,
    variantId: VariantId,
    quantity: number,
  ): Promise<{ cartId: CartId; created: boolean }> {
    return this.transactions.run(async () => {
      const now = this.clock.now();
      await this.assertSellable(variantId, now);
      const { cart, created } =
        'customerId' in target
          ? await this.customerCart(target.customerId, now)
          : { cart: await this.lockGuest(target.guestCartId), created: false };
      cart.add(variantId, quantity, now);
      await this.carts.save(cart);
      return { cartId: cart.id, created };
    });
  }

  /**
   * Sets the units of a line (UC-CRT-03), only while its variant can still be sold (ADR-0131).
   *
   * @throws NotFoundError for a missing cart or line; VariantNotSellableError; CartNotActiveError or
   *   LineQuantityError.
   */
  changeLine(
    target: CartTarget,
    variantId: VariantId,
    quantity: number,
  ): Promise<void> {
    return this.transactions.run(async () => {
      const now = this.clock.now();
      const cart = await this.lockTarget(target);
      if (cart === null) throw new NotFoundError('Cart line', variantId);
      if (cart.status === 'ACTIVE' && cart.line(variantId) !== undefined) {
        await this.assertSellable(variantId, now);
      }
      if (!cart.change(variantId, quantity, now)) {
        throw new NotFoundError('Cart line', variantId);
      }
      if (cart.hasChanges) await this.carts.save(cart);
    });
  }

  /**
   * Removes a line, sellable or not (UC-CRT-04); removing a line the cart does not have changes nothing.
   *
   * @throws NotFoundError for a guest cart that does not exist or has an owner; CartNotActiveError.
   */
  removeLine(target: CartTarget, variantId: VariantId): Promise<void> {
    return this.transactions.run(async () => {
      const cart = await this.lockTarget(target);
      if (cart === null) return;
      cart.remove(variantId, this.clock.now());
      if (cart.hasChanges) await this.carts.save(cart);
    });
  }

  /**
   * Merges a guest cart into the customer's (UC-CRT-06, ADR-0059): the lines add up to 30 units each without
   * notice, or the guest cart becomes the customer's when the customer has none. Merging again a cart already
   * merged into this customer's changes nothing. The guest cart is locked first, then the customer's: no other
   * change locks two carts, so two requests never wait for each other in a cycle.
   *
   * @throws NotFoundError when the guest cart does not exist or has another owner; CartNotActiveError when it
   *   was merged into another customer's cart or used by an order.
   */
  merge(customer: CustomerId, guestCartId: CartId): Promise<void> {
    return this.transactions.run(async () => {
      const now = this.clock.now();
      const guest = await this.carts.lock(guestCartId);
      if (guest === null) throw new NotFoundError('Cart', guestCartId);
      if (guest.ownerId !== null) {
        if (guest.ownerId !== customer) {
          throw new NotFoundError('Cart', guestCartId);
        }
        // Merged before into an account without a cart: it is the customer's own cart now.
        if (guest.status !== 'ACTIVE') {
          throw new CartNotActiveError(guest.status);
        }
        return;
      }
      if (guest.status === 'MERGED') {
        const target = await this.carts.find(guest.mergedIntoCartId!);
        if (target?.ownerId === customer) return;
        throw new CartNotActiveError(guest.status);
      }
      const own = await this.carts.lockActiveOf(customer);
      if (own === null) {
        guest.adoptBy(customer, now);
        await this.carts.save(guest);
        return;
      }
      own.absorb(guest, now);
      await this.carts.save(own);
      await this.carts.save(guest);
    });
  }

  /** The cart a change applies to, locked: `null` for a customer without an active cart. */
  private lockTarget(target: CartTarget): Promise<Cart | null> {
    return 'customerId' in target
      ? this.carts.lockActiveOf(target.customerId)
      : this.lockGuest(target.guestCartId);
  }

  /** @throws NotFoundError when the cart does not exist or has an owner (API_SPEC.md §14.1). */
  private async lockGuest(id: CartId): Promise<Cart> {
    const cart = await this.carts.lock(id);
    if (cart === null || cart.ownerId !== null) {
      throw new NotFoundError('Cart', id);
    }
    return cart;
  }

  /** The customer's active cart, locked, or a new one when the customer has none (BR-CRT-03). */
  private async customerCart(
    customer: CustomerId,
    now: Date,
  ): Promise<{ cart: Cart; created: boolean }> {
    const active = await this.carts.lockActiveOf(customer);
    if (active !== null) return { cart: active, created: false };
    const cart = Cart.open(newCredentialId<'Cart'>(), customer, now);
    await this.carts.insert(cart, now);
    return { cart, created: true };
  }

  /** @throws VariantNotSellableError unless the variant is published, active and priced now (BR-PRD-11). */
  private async assertSellable(variantId: VariantId, at: Date): Promise<void> {
    const variant = (await this.catalog.variants([variantId])).get(variantId);
    const sellable =
      variant?.onSale === true &&
      (await this.prices.current([variantId], at)).has(variantId);
    if (!sellable) throw new VariantNotSellableError([variantId]);
  }
}
