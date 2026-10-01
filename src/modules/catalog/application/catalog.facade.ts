import { Injectable } from '@nestjs/common';
import type { VariantId } from '../domain/variant.js';
import { CatalogQueries, type VariantSnapshot } from './catalog.queries.js';

export type { VariantSnapshot } from './catalog.queries.js';

/**
 * Public API of Catalog for the other contexts (ADR-0005): snapshots of variants, read on every call. Pricing
 * checks with it that a variant exists before pricing it (T-145, ADR-0125); Inventory, Shopping and Ordering
 * will take the SKU, the options and the product from it.
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
}
