import { Injectable } from '@nestjs/common';
import type { VariantId } from '../domain/variant.js';
import { CatalogQueries, type VariantSnapshot } from './catalog.queries.js';

export type { VariantSnapshot } from './catalog.queries.js';

/**
 * Public API of Catalog for the other contexts (ADR-0005): snapshots of variants, read on every call. Pricing
 * checks with it that a variant exists before pricing it and finds variants by SKU for the bulk import
 * (T-145, ADR-0125, ADR-0126). Inventory checks variants and completes and searches its stock listing with
 * it (T-160, ADR-0127); Shopping and Ordering will take the SKU, the options and the product from it.
 */
@Injectable()
export class CatalogFacade {
  constructor(private readonly queries: CatalogQueries) {}

  /**
   * The variants with these IDs, in any status and ordered by SKU. An ID that does not exist is left out, so
   * the caller decides whether that is an error.
   */
  variants(ids: readonly VariantId[]): Promise<VariantSnapshot[]> {
    const unique = [...new Set(ids)];
    return unique.length === 0
      ? Promise.resolve([])
      : this.queries.findVariants(unique);
  }

  /**
   * The variants with these SKUs, whatever their case (SKUs are stored in uppercase, BR-PRD-09), in any status
   * and ordered by SKU. A SKU that does not exist is left out. The bulk import of prices uses it (ADR-0126).
   */
  variantsBySku(skus: readonly string[]): Promise<VariantSnapshot[]> {
    const unique = [...new Set(skus.map((sku) => sku.toUpperCase()))];
    return unique.length === 0
      ? Promise.resolve([])
      : this.queries.findVariantsBySku(unique);
  }

  /**
   * The variants whose SKU or product title contains `text`, whatever its case, in any status and ordered by
   * SKU: the same search as the product listing. The stock listing of Inventory filters with it (ADR-0127).
   */
  searchVariants(text: string): Promise<VariantSnapshot[]> {
    const trimmed = text.trim();
    return trimmed === ''
      ? Promise.resolve([])
      : this.queries.searchVariants(trimmed);
  }
}
