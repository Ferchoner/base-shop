import type { Product } from './product.js';
import type { ProductId } from './product-id.js';

/**
 * Stored products with their variants (DATABASE.md §4.3 to §4.5). An abstract class rather than an interface,
 * so it can be the dependency injection token without depending on NestJS.
 */
export abstract class ProductRepository {
  abstract findById(id: ProductId): Promise<Product | null>;

  /**
   * Creates a new product or saves the changes of a stored one with its categories and variants. Rejects with
   * `VersionConflictError` when another change was saved since it was read (optimistic locking), and with
   * `DuplicateValueError` on the `slug`, on a `sku` any variant has, or on the `options` of another active
   * variant of the product.
   */
  abstract save(product: Product): Promise<void>;

  /**
   * Creates new products with their categories and variants, all in a few statements and created at `now`, for a
   * bulk import (ADR-0164). Rejects like `save`, with `DuplicateValueError` on the `slug`, `sku`, `options` or
   * `gtin`.
   */
  abstract insertNew(products: readonly Product[], now: Date): Promise<void>;

  /** Which of these slugs some product already has; archived products keep theirs (BR-PRD-09). */
  abstract takenSlugs(slugs: readonly string[]): Promise<ReadonlySet<string>>;

  /** Which of these SKUs, in uppercase, some variant already has, in any status: a SKU is never reused (BR-PRD-09). */
  abstract takenSkus(skus: readonly string[]): Promise<ReadonlySet<string>>;

  /** Which of these GTIN keys, completed to 14 digits, an active variant already has (ADR-0163). */
  abstract takenGtinKeys(keys: readonly string[]): Promise<ReadonlySet<string>>;
}
