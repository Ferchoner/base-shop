import type {
  Page,
  PageRequest,
  SortOrder,
} from '../../../shared-kernel/index.js';
import type { BrandId } from '../domain/brand.js';
import type { CatalogStatus } from '../domain/catalog-values.js';
import type { CategoryId } from '../domain/category.js';
import type { ProductStatus } from '../domain/product.js';
import type { ProductId } from '../domain/product-id.js';
import type {
  VariantId,
  VariantOptions,
  VariantStatus,
} from '../domain/variant.js';

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

export interface AdminVariantView {
  readonly id: VariantId;
  readonly sku: string;
  readonly options: VariantOptions;
  readonly status: VariantStatus;
  readonly weightGrams: number | null;
  readonly lengthCm: number | null;
  readonly widthCm: number | null;
  readonly heightCm: number | null;
}

/** An image of a product; the public URL is built from its key when answering (ADR-0024). */
export interface ProductImageView {
  readonly id: string;
  readonly storageKey: string;
  readonly altText: string | null;
  readonly position: number;
  readonly variantId: VariantId | null;
}

/** `AdminProduct` of API_SPEC.md §11.6, without `storeVisibility`, which comes with T-140 part c. */
export interface AdminProductView {
  readonly id: ProductId;
  readonly title: string;
  readonly slug: string;
  /** Only in the detail: the listing leaves it out. */
  readonly description?: string | null;
  readonly brand: { readonly id: BrandId; readonly name: string } | null;
  readonly categories: readonly {
    readonly id: CategoryId;
    readonly name: string;
  }[];
  readonly status: ProductStatus;
  /** Oldest first. */
  readonly variants: readonly AdminVariantView[];
  /** By position. */
  readonly images: readonly ProductImageView[];
  readonly publishedAt: Date | null;
  readonly firstPublishedAt: Date | null;
  readonly archivedAt: Date | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ProductFilter {
  /** Part of the title, or of a SKU, whatever its case. */
  readonly q?: string;
  readonly statuses?: readonly ProductStatus[];
  readonly brandId?: BrandId;
  /** Products directly in this category. */
  readonly categoryId?: CategoryId;
}

export type ProductSortField =
  'updatedAt' | 'title' | 'createdAt' | 'publishedAt';

/**
 * Read models of categories, brands and products for the administration (ADR-0120, ADR-0123). An abstract class rather than an interface, so it can be
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

  abstract listProducts(
    filter: ProductFilter,
    sort: readonly SortOrder<ProductSortField>[],
    page: PageRequest,
  ): Promise<Page<AdminProductView>>;

  abstract findProduct(id: ProductId): Promise<AdminProductView | null>;
}
