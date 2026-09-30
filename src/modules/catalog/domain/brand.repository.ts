import type { Brand, BrandId } from './brand.js';

/**
 * Stored brands (DATABASE.md §4.1). An abstract class rather than an interface, so it can be the dependency
 * injection token without depending on NestJS.
 */
export abstract class BrandRepository {
  abstract findById(id: BrandId): Promise<Brand | null>;

  /**
   * Creates a new brand or saves the changes of a stored one. Rejects with `DuplicateValueError` on the `name`
   * when another brand has it, whatever its case, or on the `slug`.
   */
  abstract save(brand: Brand): Promise<void>;

  /** Rejects with `ResourceInUseError` while a product has it (BR-PRD-10). */
  abstract delete(brand: Brand): Promise<void>;

  /** Which of these slugs some brand already has. */
  abstract takenSlugs(slugs: readonly string[]): Promise<ReadonlySet<string>>;
}
