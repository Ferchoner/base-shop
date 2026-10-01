import { Injectable } from '@nestjs/common';
import { CatalogFacade } from '../../catalog/index.js';
import {
  CatalogVariants,
  type VariantLabel,
} from '../application/catalog-variants.js';
import type { VariantId } from '../domain/stock.js';

/**
 * Answers Inventory's `CatalogVariants` port with Catalog's facade (ADR-0005, ADR-0127): Inventory depends on
 * Catalog, never the other way round, so the two modules never form a cycle.
 */
@Injectable()
export class CatalogFacadeVariants extends CatalogVariants {
  constructor(private readonly catalog: CatalogFacade) {
    super();
  }

  async exists(variantId: VariantId): Promise<boolean> {
    return (await this.catalog.variants([variantId])).length > 0;
  }

  async labels(
    variantIds: readonly VariantId[],
  ): Promise<ReadonlyMap<VariantId, VariantLabel>> {
    const variants = await this.catalog.variants(variantIds);
    return new Map(
      variants.map(({ id, sku, productTitle }) => [id, { sku, productTitle }]),
    );
  }

  async search(text: string): Promise<VariantId[]> {
    return (await this.catalog.searchVariants(text)).map(({ id }) => id);
  }

  async findBySku(sku: string): Promise<VariantId | null> {
    const [variant] = await this.catalog.variantsBySku([sku]);
    return variant?.id ?? null;
  }
}
