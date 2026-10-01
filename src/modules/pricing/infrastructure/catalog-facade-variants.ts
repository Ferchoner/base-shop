import { Injectable } from '@nestjs/common';
import { CatalogFacade } from '../../catalog/index.js';
import { CatalogVariants } from '../application/catalog-variants.js';
import type { VariantId } from '../domain/variant-price.js';

/**
 * Answers Pricing's `CatalogVariants` port with Catalog's facade (ADR-0005, ADR-0125): Pricing depends on
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

  async findBySkus(
    skus: readonly string[],
  ): Promise<ReadonlyMap<string, VariantId>> {
    const variants = await this.catalog.variantsBySku(skus);
    return new Map(variants.map(({ sku, id }) => [sku, id]));
  }
}
