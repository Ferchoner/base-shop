import type {
  Page,
  PageRequest,
  SortOrder,
} from '../../../shared-kernel/index.js';
import type { BrandId } from '../domain/brand.js';
import type { CatalogStatus } from '../domain/catalog-values.js';
import type { CategoryId } from '../domain/category.js';

/** `AdminCategory` of API_SPEC.md §11.9, without its place in the tree. */
export interface CategoryView {
  readonly id: CategoryId;
  readonly parentId: CategoryId | null;
  readonly name: string;
  readonly slug: string;
  readonly status: CatalogStatus;
  readonly position: number;
  /** Products in any status, as the rule for deleting it counts them (BR-PRD-10). */
  readonly productCount: number;
  /** Direct subcategories, active or not. */
  readonly childCount: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** `AdminBrand` of API_SPEC.md §11.9. */
export interface BrandView {
  readonly id: BrandId;
  readonly name: string;
  readonly slug: string;
  readonly status: CatalogStatus;
  /** Products in any status, as the rule for deleting it counts them (BR-PRD-10). */
  readonly productCount: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface BrandFilter {
  /** Part of the name, whatever its case. */
  readonly q?: string;
  readonly statuses?: readonly CatalogStatus[];
}

export type BrandSortField = 'name';

/**
 * Read models of categories and brands (ADR-0120). An abstract class rather than an interface, so it can be
 * the dependency injection token without depending on NestJS.
 */
export abstract class CatalogQueries {
  /** Every category, active or not, as a flat list; `category-trees.ts` builds the trees. */
  abstract listCategories(): Promise<CategoryView[]>;

  abstract findCategory(id: CategoryId): Promise<CategoryView | null>;

  abstract listBrands(
    filter: BrandFilter,
    sort: readonly SortOrder<BrandSortField>[],
    page: PageRequest,
  ): Promise<Page<BrandView>>;

  abstract findBrand(id: BrandId): Promise<BrandView | null>;
}
