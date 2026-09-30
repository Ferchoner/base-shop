import { NotFoundError } from '../../../shared-kernel/index.js';
import type { BrandId } from '../domain/brand.js';
import type { BrandRepository } from '../domain/brand.repository.js';
import type { CategoryId } from '../domain/category.js';
import type { CategoryRepository } from '../domain/category.repository.js';
import type { Product } from '../domain/product.js';
import {
  UnusableBrandError,
  UnusableCategoriesError,
} from '../domain/product-errors.js';
import type { ProductId } from '../domain/product-id.js';
import type { ProductRepository } from '../domain/product.repository.js';
import type { VariantId, VariantSnapshot } from '../domain/variant.js';

/**
 * What the audit trail keeps of a product (ADR-0100): its data and status. The description is recorded only as
 * changed, since it can be long.
 */
export function auditedProductFields(
  product: Product,
): Record<string, unknown> {
  const { title, slug, description, brandId, categoryIds, status } =
    product.snapshot();
  return {
    title,
    slug,
    description,
    brandId,
    categoryIds: [...categoryIds].sort(),
    status,
  };
}

/** Fields of `auditedProductFields` recorded only as changed. */
export const LONG_PRODUCT_FIELDS = ['description'];

/** What the audit trail keeps of a variant. */
export function auditedVariantFields(
  variant: VariantSnapshot | undefined,
): Record<string, unknown> {
  if (variant === undefined) return {};
  const { sku, options, status, weightGrams, lengthCm, widthCm, heightCm } =
    variant;
  return { sku, options, status, weightGrams, lengthCm, widthCm, heightCm };
}

export function variantOf(
  product: Product,
  variantId: VariantId,
): VariantSnapshot | undefined {
  return product.snapshot().variants.find(({ id }) => id === variantId);
}

export async function findProduct(
  products: ProductRepository,
  id: ProductId,
): Promise<Product> {
  const product = await products.findById(id);
  if (product === null) throw new NotFoundError('Product', id);
  return product;
}

/** A brand given to a product must exist and be active (API_SPEC.md §11.6). */
export async function assertUsableBrand(
  brands: BrandRepository,
  brandId: BrandId,
): Promise<void> {
  const brand = await brands.findById(brandId);
  if (brand === null) throw new UnusableBrandError('unknown');
  if (brand.snapshot().status !== 'ACTIVE') {
    throw new UnusableBrandError('inactive');
  }
}

/**
 * Categories given to a product must exist and be active (API_SPEC.md §11.6). Only the new ones are checked,
 * so a product keeps a category that was deactivated after it was assigned (ADR-0123).
 */
export async function assertUsableCategories(
  categories: CategoryRepository,
  ids: readonly CategoryId[],
): Promise<void> {
  if (ids.length === 0) return;
  const found = await categories.findByIds(ids);
  if (found.length !== new Set(ids).size) {
    throw new UnusableCategoriesError('unknown');
  }
  if (found.some(({ status }) => status !== 'ACTIVE')) {
    throw new UnusableCategoriesError('inactive');
  }
}
