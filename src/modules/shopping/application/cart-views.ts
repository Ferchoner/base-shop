import { Injectable } from '@nestjs/common';
import { Clock, Money, NotFoundError } from '../../../shared-kernel/index.js';
import type {
  Cart,
  CartId,
  CartStatus,
  CustomerId,
  VariantId,
} from '../domain/cart.js';
import { CartRepository } from '../domain/cart.repository.js';
import {
  CartCatalog,
  type CartImage,
  CartPrices,
  CartStock,
  type CartVariant,
} from './cart-ports.js';

/** A line of `Cart` (API_SPEC.md §8.6). */
export interface CartLineView {
  readonly variantId: VariantId;
  readonly quantity: number;
  readonly product: CartVariant['product'];
  readonly sku: string;
  readonly options: Readonly<Record<string, string>>;
  readonly image: CartImage | null;
  /** Published product, active variant and a current price (BR-PRD-11). */
  readonly sellable: boolean;
  /** Whether its units are available; never for a line that cannot be sold (ADR-0061). */
  readonly canFulfill: boolean;
  /** Read now from Pricing, never kept in the cart (BR-CRT-04); `null` when it cannot be sold. */
  readonly unitPrice: Money | null;
  readonly lineTotal: Money | null;
}

/** `Cart` of API_SPEC.md §8.6. */
export interface CartView {
  /** `null` for a customer without an active cart. */
  readonly id: CartId | null;
  readonly status: CartStatus;
  /** Oldest first. */
  readonly lines: readonly CartLineView[];
  /** Units of every line, sellable or not. */
  readonly itemCount: number;
  /** Lines that can be sold, taxes included. */
  readonly subtotal: Money;
  readonly lastActivityAt: Date | null;
}

/** The cart of a customer who has none yet. */
export const EMPTY_CART: CartView = {
  id: null,
  status: 'ACTIVE',
  lines: [],
  itemCount: 0,
  subtotal: Money.zero('MXN'),
  lastActivityAt: null,
};

/**
 * Builds the view of a cart when it is read (UC-CRT-05): the product data from Catalog, the price in force now
 * from Pricing and the availability from Inventory, so nothing in the cart can fall behind (BR-CRT-04).
 */
@Injectable()
export class CartViews {
  constructor(
    private readonly carts: CartRepository,
    private readonly catalog: CartCatalog,
    private readonly prices: CartPrices,
    private readonly stock: CartStock,
    private readonly clock: Clock,
  ) {}

  /**
   * A guest cart, in any status: a merged or checked out cart shows its status, so the client knows to use
   * another one (API_SPEC.md §14.2).
   *
   * @throws NotFoundError when it does not exist or has an owner (API_SPEC.md §14.1).
   */
  async guestCart(id: CartId): Promise<CartView> {
    const cart = await this.carts.find(id);
    if (cart === null || cart.ownerId !== null) {
      throw new NotFoundError('Cart', id);
    }
    return this.of(cart);
  }

  /** The active cart of the customer, or an empty one with `id: null` when there is none. */
  async customerCart(customer: CustomerId): Promise<CartView> {
    const cart = await this.carts.findActiveOf(customer);
    return cart === null ? EMPTY_CART : this.of(cart);
  }

  private async of(cart: Cart): Promise<CartView> {
    const lines = cart.lines;
    const variants = await this.catalog.variants(
      lines.map(({ variantId }) => variantId),
    );
    const onSale = lines.filter(
      ({ variantId }) => variants.get(variantId)?.onSale === true,
    );
    const prices = await this.prices.current(
      onSale.map(({ variantId }) => variantId),
      this.clock.now(),
    );
    const sellable = onSale.filter(({ variantId }) => prices.has(variantId));
    const available = await this.stock.canFulfill(sellable);
    const views = lines.map(({ variantId, quantity }) => {
      const variant = variants.get(variantId);
      // Variants are never deleted (BR-PRD-07), and a line is only added for one that exists.
      if (variant === undefined) {
        throw new Error(
          `The cart has a line of variant ${variantId}, which does not exist`,
        );
      }
      const unitPrice = prices.get(variantId) ?? null;
      return {
        variantId,
        quantity,
        product: variant.product,
        sku: variant.sku,
        options: variant.options,
        image: variant.image,
        sellable: unitPrice !== null,
        canFulfill: available.get(variantId) === true,
        unitPrice,
        lineTotal: unitPrice === null ? null : unitPrice.multiply(quantity),
      };
    });
    return {
      id: cart.id,
      status: cart.status,
      lines: views,
      itemCount: lines.reduce((sum, { quantity }) => sum + quantity, 0),
      subtotal: views.reduce(
        (sum, { lineTotal }) => (lineTotal === null ? sum : sum.add(lineTotal)),
        Money.zero('MXN'),
      ),
      lastActivityAt: cart.lastActivityAt,
    };
  }
}
