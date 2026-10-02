import type { CartId, CustomerId, VariantId } from '../domain/order.js';

/** A line of an order to buy again: its variant and units. */
export interface ReorderLine {
  readonly variantId: VariantId;
  readonly quantity: number;
}

/** The cart the lines went into, and the variants left out because they are no longer sold. */
export interface CartCopy {
  readonly cartId: CartId;
  readonly skippedVariantIds: readonly VariantId[];
}

/**
 * The carts of Shopping, to buy an order again (UC-CRT-09, ADR-0139). Shopping keeps only the variants sold now,
 * adds up to 30 units per line, and joins the transaction of the caller.
 */
export abstract class ReorderCarts {
  /** Into the customer's active cart, or a new one when the customer has none. */
  abstract copyToCustomerCart(
    customerId: CustomerId,
    lines: readonly ReorderLine[],
  ): Promise<CartCopy>;

  /**
   * Into the active guest cart given, or a new one when none is given.
   *
   * @throws NotFoundError when the cart given does not exist or has an owner; CartNotActiveError when it is not
   *   active.
   */
  abstract copyToGuestCart(
    cartId: CartId | null,
    lines: readonly ReorderLine[],
  ): Promise<CartCopy>;

  /** Into the guest cart the order came from; `null` when it is no longer the guest's or no longer exists. */
  abstract copyToSourceCart(
    sourceCartId: CartId,
    lines: readonly ReorderLine[],
  ): Promise<CartCopy | null>;
}
