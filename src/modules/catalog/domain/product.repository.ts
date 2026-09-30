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

  /** Which of these slugs some product already has; archived products keep theirs (BR-PRD-09). */
  abstract takenSlugs(slugs: readonly string[]): Promise<ReadonlySet<string>>;
}
