import type { BrandId } from '../domain/brand.js';
import type { CategoryId } from '../domain/category.js';
import type { ProductId } from '../domain/product-id.js';

/**
 * The text the store searches in each product (ADR-0060, ADR-0080, ADR-0123): its title, its brand and its
 * visible categories. Kept in `products.search_vector` and refreshed in the same transaction as the change,
 * so a search never sees stale names or hidden categories. An abstract class rather than an interface, so it
 * can be the dependency injection token without depending on NestJS.
 */
export abstract class ProductSearchIndex {
  abstract refreshProducts(ids: readonly ProductId[]): Promise<void>;

  /**
   * The products of these categories and of every subcategory under them: a rename changes the names, and a
   * move, deactivation or reactivation changes which categories are visible (BR-PRD-17).
   */
  abstract refreshCategories(ids: readonly CategoryId[]): Promise<void>;

  /** The products of a brand, after a rename. */
  abstract refreshBrand(id: BrandId): Promise<void>;
}
