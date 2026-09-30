import type { Category, CategoryId } from './category.js';

/**
 * Stored categories (DATABASE.md §4.2). An abstract class rather than an interface, so it can be the
 * dependency injection token without depending on NestJS.
 */
export abstract class CategoryRepository {
  abstract findById(id: CategoryId): Promise<Category | null>;

  /**
   * Creates a new category or saves the changes of a stored one. Rejects with `DuplicateValueError` on the
   * `name` when a sibling has it, whatever its case, or on the `slug` when any category has it.
   */
  abstract save(category: Category): Promise<void>;

  /** Rejects with `ResourceInUseError` while it has subcategories or products (BR-PRD-10). */
  abstract delete(category: Category): Promise<void>;

  /** The category and all its ancestors up to the root, in no particular order; empty if it does not exist. */
  abstract lineage(id: CategoryId): Promise<CategoryId[]>;

  /** Which of these slugs some category already has. */
  abstract takenSlugs(slugs: readonly string[]): Promise<ReadonlySet<string>>;

  /**
   * Holds the lock of the category tree until the transaction ends. Every move takes it before checking for
   * cycles, so two moves never check at the same time and create a cycle between them (BR-PRD-03, ADR-0120).
   */
  abstract lockTree(): Promise<void>;
}
