import type { VariantId } from '../domain/variant-price.js';

/**
 * Prices are set only for variants that exist in Catalog (API_SPEC.md §12), which Pricing's application layer
 * cannot import (ADR-0103). This port states what it needs; an adapter in Pricing's infrastructure answers
 * it through Catalog's facade (ADR-0005, ADR-0125). An abstract class rather than an interface, so it can be
 * the dependency injection token without depending on NestJS.
 */
export abstract class CatalogVariants {
  /** Whether the variant exists, in any status: the store already hides one that cannot be sold. */
  abstract exists(variantId: VariantId): Promise<boolean>;
}
