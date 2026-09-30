import { Injectable } from '@nestjs/common';
import {
  AuditTrail,
  changesBetween,
  newId,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import type { BrandId } from '../domain/brand.js';
import { BrandRepository } from '../domain/brand.repository.js';
import type { CategoryId } from '../domain/category.js';
import { CategoryRepository } from '../domain/category.repository.js';
import { Product } from '../domain/product.js';
import type { ProductId } from '../domain/product-id.js';
import { ProductRepository } from '../domain/product.repository.js';
import { MAX_PRODUCT_SLUG_LENGTH } from '../domain/slug.js';
import { retryingGeneratedSlug, slugFor } from './catalog-slugs.js';
import { ProductSearchIndex } from './product-search-index.js';
import {
  assertUsableBrand,
  assertUsableCategories,
  auditedProductFields,
  LONG_PRODUCT_FIELDS,
} from './product-support.js';

/**
 * Creates a product in DRAFT, without variants (UC-CAT-04). Without a slug, it gets one from the title,
 * numbered if taken (ADR-0123). Brand and categories must be active.
 */
@Injectable()
export class CreateProduct {
  constructor(
    private readonly products: ProductRepository,
    private readonly brands: BrandRepository,
    private readonly categories: CategoryRepository,
    private readonly searchIndex: ProductSearchIndex,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
  ) {}

  execute(input: {
    title: string;
    slug?: string;
    description: string | null;
    brandId: BrandId | null;
    categoryIds: readonly CategoryId[];
  }): Promise<ProductId> {
    return retryingGeneratedSlug(input.slug, () =>
      this.transactions.run(async () => {
        if (input.brandId !== null) {
          await assertUsableBrand(this.brands, input.brandId);
        }
        await assertUsableCategories(this.categories, input.categoryIds);
        const product = Product.create({
          id: newId(),
          title: input.title,
          slug: await slugFor(
            input.title,
            input.slug,
            (slugs) => this.products.takenSlugs(slugs),
            MAX_PRODUCT_SLUG_LENGTH,
          ),
          description: input.description,
          brandId: input.brandId,
          categoryIds: input.categoryIds,
        });
        await this.products.save(product);
        await this.searchIndex.refreshProducts([product.id]);
        await this.audit.record({
          action: 'products.create',
          resource: { type: 'product', id: product.id },
          changes: changesBetween({}, auditedProductFields(product), {
            personal: LONG_PRODUCT_FIELDS,
          }),
        });
        return product.id;
      }),
    );
  }
}
