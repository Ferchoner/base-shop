import { Injectable } from '@nestjs/common';
import {
  Clock,
  NotFoundError,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import type {
  Cart,
  CartId,
  CartItem,
  CustomerId,
  VariantId,
} from '../domain/cart.js';
import { CartNotActiveError } from '../domain/cart-errors.js';
import { CartRepository } from '../domain/cart.repository.js';
import { CartCopies, type CartCopy } from './cart-copies.js';
import type { CartTarget } from './carts.use-case.js';
import { CustomerCarts } from './customer-carts.js';

/** The content of an active cart, as the checkout needs it: no prices, which the order works out itself. */
export interface CheckoutCart {
  readonly id: CartId;
  /** Oldest first, as the cart shows them. */
  readonly lines: readonly {
    readonly variantId: VariantId;
    readonly quantity: number;
  }[];
}

/**
 * Public API of Shopping (ADR-0005): for Ordering, the checkout (T-180) and buying an order again (T-181, ADR-0139);
 * for Privacy, deleting the carts of a customer being anonymized (ADR-0145). Neither is used by Shopping, so they
 * never form a cycle. Every operation joins the transaction of its caller, so the checkout locks the cart, creates
 * the order and marks the cart all at once (ADR-0019).
 */
@Injectable()
export class ShoppingFacade {
  constructor(
    private readonly carts: CartRepository,
    private readonly copies: CartCopies,
    private readonly transactions: TransactionManager,
    private readonly clock: Clock,
    private readonly customerCarts: CustomerCarts,
  ) {}

  /**
   * The active cart a checkout quotes (UC-ORD-01), without locking it; `null` when the customer has none.
   *
   * @throws NotFoundError for a guest cart that does not exist or has an owner; CartNotActiveError for a guest
   *   cart that was merged or used by an order.
   */
  async cartToQuote(target: CartTarget): Promise<CheckoutCart | null> {
    const cart =
      'customerId' in target
        ? await this.carts.findActiveOf(target.customerId)
        : guestCart(await this.carts.find(target.guestCartId), target);
    return cart === null ? null : contentOf(cart);
  }

  /**
   * The active cart an order is placed from (UC-ORD-02), locked until the transaction of the caller ends, so no
   * change gets in between the quote and the order (ADR-0131); `null` when the customer has none.
   *
   * @throws NotFoundError or CartNotActiveError, as `cartToQuote`.
   */
  lockCartToOrder(target: CartTarget): Promise<CheckoutCart | null> {
    return this.transactions.run(async () => {
      const cart =
        'customerId' in target
          ? await this.carts.lockActiveOf(target.customerId)
          : guestCart(await this.carts.lock(target.guestCartId), target);
      return cart === null ? null : contentOf(cart);
    });
  }

  /**
   * Leaves the cart CHECKED_OUT (UC-ORD-02), in the transaction that locked it with `lockCartToOrder`.
   *
   * @throws CartNotActiveError.
   */
  checkOut(id: CartId): Promise<void> {
    return this.transactions.run(async () => {
      const cart = await this.carts.lock(id);
      if (cart === null) throw new NotFoundError('Cart', id);
      cart.checkOut(this.clock.now());
      await this.carts.save(cart);
    });
  }

  /** The lines of an order into the customer's active cart, or a new one, to buy them again (UC-CRT-09). */
  copyToCustomerCart(
    customer: CustomerId,
    lines: readonly CartItem[],
  ): Promise<CartCopy> {
    return this.copies.toCustomerCart(customer, lines);
  }

  /**
   * The lines of a guest order into the active guest cart given, or a new one (UC-CRT-09).
   *
   * @throws NotFoundError or CartNotActiveError for the cart given.
   */
  copyToGuestCart(
    cartId: CartId | null,
    lines: readonly CartItem[],
  ): Promise<CartCopy> {
    return this.copies.toGuestCart(cartId, lines);
  }

  /**
   * Deletes every cart of a customer being anonymized, with their lines and the guest carts merged into them
   * (UC-IAM-19, ADR-0067), in the transaction of the caller.
   */
  deleteCartsOf(customer: CustomerId): Promise<void> {
    return this.customerCarts.deleteOf(customer);
  }

  /**
   * The lines of a guest order into the cart it came from, for the staff (UC-CRT-09, ADR-0082); `null` when that
   * cart is no longer available.
   */
  copyToSourceCart(
    sourceCartId: CartId,
    lines: readonly CartItem[],
  ): Promise<CartCopy | null> {
    return this.copies.toSourceCart(sourceCartId, lines);
  }
}

/**
 * The guest cart of the target, active.
 *
 * @throws NotFoundError when it does not exist or has an owner (API_SPEC.md §15.2); CartNotActiveError.
 */
function guestCart(
  cart: Cart | null,
  target: { readonly guestCartId: CartId },
): Cart {
  if (cart === null || cart.ownerId !== null) {
    throw new NotFoundError('Cart', target.guestCartId);
  }
  if (cart.status !== 'ACTIVE') throw new CartNotActiveError(cart.status);
  return cart;
}

function contentOf(cart: Cart): CheckoutCart {
  return {
    id: cart.id,
    lines: cart.lines.map(({ variantId, quantity }) => ({
      variantId,
      quantity,
    })),
  };
}
