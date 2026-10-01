import type { Money } from '../../../shared-kernel/index.js';
import type { VariantId } from '../domain/cart.js';

/** The image a cart line shows: the main one of its variant, or else of its product (ADR-0131). */
export interface CartImage {
  readonly id: string;
  /** Absolute, built by Catalog (ADR-0024). */
  readonly url: string;
  readonly altText: string | null;
  readonly position: number;
  readonly variantId: VariantId | null;
}

/** What a cart line shows of a variant of Catalog. */
export interface CartVariant {
  readonly id: VariantId;
  readonly sku: string;
  readonly options: Readonly<Record<string, string>>;
  readonly product: {
    readonly id: string;
    readonly slug: string;
    readonly title: string;
  };
  readonly image: CartImage | null;
  /** Its product is published and the variant is active: it is sellable once it has a current price (BR-PRD-11). */
  readonly onSale: boolean;
}

/**
 * What Shopping needs of Catalog, Pricing and Inventory, which its application layer cannot import (ADR-0103).
 * Adapters in Shopping's infrastructure answer these ports with the facades of those contexts (ADR-0005); none
 * of them uses Shopping, so they never form a cycle (ADR-0131). Abstract classes rather than interfaces, so
 * they can be dependency injection tokens without depending on NestJS.
 */
export abstract class CartCatalog {
  /** The variants with these IDs, in any status; an ID that does not exist is left out. */
  abstract variants(
    ids: readonly VariantId[],
  ): Promise<ReadonlyMap<VariantId, CartVariant>>;
}

export abstract class CartPrices {
  /** The price of each variant in force at `at`, taxes included; a variant without one is left out. */
  abstract current(
    ids: readonly VariantId[],
    at: Date,
  ): Promise<ReadonlyMap<VariantId, Money>>;
}

export abstract class CartStock {
  /** Whether the units of each line are available, yes or no, never how many (ADR-0061). */
  abstract canFulfill(
    lines: readonly { variantId: VariantId; quantity: number }[],
  ): Promise<ReadonlyMap<VariantId, boolean>>;
}
