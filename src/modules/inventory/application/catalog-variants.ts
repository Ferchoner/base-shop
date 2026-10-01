import type { VariantId } from '../domain/stock.js';

/** What the stock listing shows of a variant. */
export interface VariantLabel {
  readonly sku: string;
  readonly productTitle: string;
}

/**
 * What Inventory needs of Catalog's variants, which its application layer cannot import (ADR-0103): an
 * adapter in Inventory's infrastructure answers it through Catalog's facade (ADR-0005, ADR-0127). The stock
 * listing reads SKUs and titles from here on every page instead of keeping a copy that could fall behind. An
 * abstract class rather than an interface, so it can be the dependency injection token without depending on
 * NestJS.
 */
export abstract class CatalogVariants {
  /** Whether the variant exists, in any status. */
  abstract exists(variantId: VariantId): Promise<boolean>;

  /** SKU and product title of each variant that exists, in the order of their SKUs (Catalog's order). */
  abstract labels(
    variantIds: readonly VariantId[],
  ): Promise<ReadonlyMap<VariantId, VariantLabel>>;

  /** The variants whose SKU or product title contains `text`, whatever its case. */
  abstract search(text: string): Promise<VariantId[]>;

  /** The variant with this SKU, whatever its case, or `null`. */
  abstract findBySku(sku: string): Promise<VariantId | null>;
}
