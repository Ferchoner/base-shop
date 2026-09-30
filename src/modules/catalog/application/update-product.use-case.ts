import { Injectable } from '@nestjs/common';
import {
  assertVersion,
  AuditTrail,
  changesBetween,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import type { BrandId } from '../domain/brand.js';
import { BrandRepository } from '../domain/brand.repository.js';
import type { CategoryId } from '../domain/category.js';
import { CategoryRepository } from '../domain/category.repository.js';
import type { ProductId } from '../domain/product-id.js';
import { ProductRepository } from '../domain/product.repository.js';
import { ProductSearchIndex } from './product-search-index.js';
import {
  assertUsableBrand,
  assertUsableCategories,
  auditedProductFields,
  findProduct,
  LONG_PRODUCT_FIELDS,
} from './product-support.js';

/** Fields that the search reads (ADR-0060): a change in any of them refreshes the search vector. */
const SEARCHED_FIELDS = ['title', 'brandId', 'categoryIds'];

/**
 * Edits the data of a product (UC-CAT-05) with optimistic locking. The slug is fixed from the first
 * publication (ADR-0068). A new brand or category must be active; one the product already had stays even if
 * it was deactivated later (ADR-0123). Without changes, nothing is saved or audited.
 */
@Injectable()
export class UpdateProduct {
  constructor(
    private readonly products: ProductRepository,
    private readonly brands: BrandRepository,
    private readonly categories: CategoryRepository,
    private readonly searchIndex: ProductSearchIndex,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
  ) {}

  execute(
    id: ProductId,
    changes: {
      title?: string;
      slug?: string;
      description?: string | null;
      brandId?: BrandId | null;
      categoryIds?: readonly CategoryId[];
      version: number;
    },
  ): Promise<void> {
    return this.transactions.run(async () => {
      const product = await findProduct(this.products, id);
      assertVersion(product.version, changes.version);
      const before = auditedProductFields(product);
      const { brandId, categoryIds } = changes;
      if (
        brandId !== undefined &&
        brandId !== null &&
        brandId !== product.brandId
      ) {
        await assertUsableBrand(this.brands, brandId);
      }
      if (categoryIds !== undefined) {
        const added = categoryIds.filter(
          (categoryId) => !product.categoryIds.includes(categoryId),
        );
        await assertUsableCategories(this.categories, added);
      }
      product.editDetails(changes);
      const audited = changesBetween(before, auditedProductFields(product), {
        personal: LONG_PRODUCT_FIELDS,
      });
      if (Object.keys(audited).length === 0) return;
      await this.products.save(product);
      if (SEARCHED_FIELDS.some((field) => field in audited)) {
        await this.searchIndex.refreshProducts([id]);
      }
      await this.audit.record({
        action: 'products.update',
        resource: { type: 'product', id },
        changes: audited,
      });
    });
  }
}
