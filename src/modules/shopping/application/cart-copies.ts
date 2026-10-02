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
  type CartItem,
  type CustomerId,
  type VariantId,
} from '../domain/cart.js';
import { CartRepository } from '../domain/cart.repository.js';
import { CartCatalog, CartPrices } from './cart-ports.js';

/** The cart the lines of an order went into, and the variants left out because they are no longer sold. */
export interface CartCopy {
  readonly cartId: CartId;
  readonly skippedVariantIds: readonly VariantId[];
}

/**
 * Copies the lines of a cancelled or refunded order into a cart, to buy them again (UC-CRT-09, BR-CRT-11,
 * ADR-0055, ADR-0139). Only the variants sold now go in, up to 30 units per line without notice; the cart works
 * out prices and availability when it is read (BR-CRT-04). Each copy joins the transaction of its caller.
 */
@Injectable()
export class CartCopies {
  constructor(
    private readonly carts: CartRepository,
    private readonly catalog: CartCatalog,
    private readonly prices: CartPrices,
    private readonly transactions: TransactionManager,
    private readonly clock: Clock,
  ) {}

  /** Into the customer's active cart, or a new one when the customer has none (BR-CRT-03). */
  toCustomerCart(
    customer: CustomerId,
    items: readonly CartItem[],
  ): Promise<CartCopy> {
    return this.transactions.run(async () => {
      const now = this.clock.now();
      let cart = await this.carts.lockActiveOf(customer);
      if (cart === null) {
        cart = Cart.open(newCredentialId<'Cart'>(), customer, now);
        await this.carts.insert(cart, now);
      }
      return this.copy(cart, items, now);
    });
  }

  /**
   * Into a guest cart: the active cart without owner given, or a new one when none is given.
   *
   * @throws NotFoundError when the cart given does not exist or has an owner; CartNotActiveError when it is not
   *   active.
   */
  toGuestCart(
    cartId: CartId | null,
    items: readonly CartItem[],
  ): Promise<CartCopy> {
    return this.transactions.run(async () => {
      const now = this.clock.now();
      if (cartId === null) {
        const cart = Cart.open(newCredentialId<'Cart'>(), null, now);
        await this.carts.insert(cart, now);
        return this.copy(cart, items, now);
      }
      const cart = await this.carts.lock(cartId);
      if (cart === null || cart.ownerId !== null) {
        throw new NotFoundError('Cart', cartId);
      }
      return this.copy(cart, items, now);
    });
  }

  /**
   * Into the guest cart the order came from, for the staff (ADR-0082, ADR-0139): still CHECKED_OUT, it is ACTIVE
   * again with only the lines that are still sold; ACTIVE, it gets them added.
   *
   * @returns null, changing nothing, when that cart no longer exists or is no longer the guest's: it has an owner,
   *   or it was MERGED into a customer's cart.
   */
  toSourceCart(
    sourceCartId: CartId,
    items: readonly CartItem[],
  ): Promise<CartCopy | null> {
    return this.transactions.run(async () => {
      const cart = await this.carts.lock(sourceCartId);
      if (cart === null || cart.ownerId !== null || cart.status === 'MERGED') {
        return null;
      }
      const now = this.clock.now();
      if (cart.status === 'ACTIVE') return this.copy(cart, items, now);
      const { sold, skippedVariantIds } = await this.sold(items, now);
      cart.reopenWith(sold, now);
      await this.carts.save(cart);
      return { cartId: cart.id, skippedVariantIds };
    });
  }

  private async copy(
    cart: Cart,
    items: readonly CartItem[],
    now: Date,
  ): Promise<CartCopy> {
    const { sold, skippedVariantIds } = await this.sold(items, now);
    cart.copyOrderLines(sold, now);
    await this.carts.save(cart);
    return { cartId: cart.id, skippedVariantIds };
  }

  /** The items of variants sold now, published, active and priced (BR-PRD-11), and the variants left out. */
  private async sold(
    items: readonly CartItem[],
    at: Date,
  ): Promise<{ sold: CartItem[]; skippedVariantIds: VariantId[] }> {
    const ids = items.map(({ variantId }) => variantId);
    const variants = await this.catalog.variants(ids);
    const prices = await this.prices.current(ids, at);
    const isSold = (id: VariantId) =>
      variants.get(id)?.onSale === true && prices.has(id);
    return {
      sold: items.filter(({ variantId }) => isSold(variantId)),
      skippedVariantIds: ids.filter((id) => !isSold(id)),
    };
  }
}
