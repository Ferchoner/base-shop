import { Injectable } from '@nestjs/common';
import { CatalogFacade } from '../../catalog/index.js';
import {
  type CatalogTarget,
  PromotionCatalog,
  type VariantClassification,
} from '../application/promotion-ports.js';
import type { PromotionTarget } from '../domain/promotion.js';

@Injectable()
export class CatalogFacadePromotionCatalog extends PromotionCatalog {
  constructor(private readonly catalog: CatalogFacade) {
    super();
  }

  async targets(
    targets: readonly PromotionTarget[],
  ): Promise<readonly CatalogTarget[]> {
    const idsOf = (type: PromotionTarget['type']) =>
      targets.filter((target) => target.type === type).map(({ id }) => id);
    const found = await this.catalog.entries({
      productIds: idsOf('PRODUCT'),
      categoryIds: idsOf('CATEGORY'),
      brandIds: idsOf('BRAND'),
    });
    // In use (ADR-0168): a product that is not archived, or an active category or brand.
    return [
      ...found.products.map(({ id, name, status }) => ({
        type: 'PRODUCT' as const,
        id,
        name,
        usable: status !== 'ARCHIVED',
      })),
      ...found.categories.map(({ id, name, status }) => ({
        type: 'CATEGORY' as const,
        id,
        name,
        usable: status === 'ACTIVE',
      })),
      ...found.brands.map(({ id, name, status }) => ({
        type: 'BRAND' as const,
        id,
        name,
        usable: status === 'ACTIVE',
      })),
    ];
  }

  classify(
    variantIds: readonly string[],
  ): Promise<readonly VariantClassification[]> {
    return this.catalog.classifications(variantIds);
  }
}
