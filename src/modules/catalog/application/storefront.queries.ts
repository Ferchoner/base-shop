import type { Money, Page, PageRequest } from '../../../shared-kernel/index.js';
import type { BrandId } from '../domain/brand.js';
import type { CategoryId } from '../domain/category.js';
import type { ProductId } from '../domain/product-id.js';
import type { VariantId, VariantOptions } from '../domain/variant.js';
import type { ProductImageView } from './catalog.queries.js';

/**
 * Whether the store shows a product (UC-CAT-14, ADR-0016, ADR-0129): published with a sellable variant,
 * published without any, or not published (draft or archived).
 */
export const STORE_VISIBILITIES = [
  'VISIBLE',
  'HIDDEN_NO_PRICE',
  'NOT_PUBLISHED',
] as const;

export type StoreVisibility = (typeof STORE_VISIBILITIES)[number];

/** Orders of the store listing (API_SPEC.md §11.2); `relevance` only with a search text. */
export const STOREFRONT_SORTS = [
  'relevance',
  '-publishedAt',
  'price',
  '-price',
  'title',
  '-title',
] as const;

export type StorefrontSort = (typeof STOREFRONT_SORTS)[number];

/** What the store listing filters by, with the slugs of the request already turned into IDs. */
export interface StorefrontCriteria {
  /** Words of the search: each one matches the start of a word, and all of them must match. */
  readonly words?: readonly string[];
  /** A visible category and every visible subcategory under it. */
  readonly categoryIds?: readonly CategoryId[];
  readonly brandIds?: readonly BrandId[];
  /** Cents, taxes included, compared with the price of the product (BR-PRD-15). */
  readonly minPrice?: number;
  readonly maxPrice?: number;
  /** Only products with an available sellable variant (ADR-0061). */
  readonly availableOnly: boolean;
  readonly sort: StorefrontSort;
}

/** A brand as the store shows it. */
export interface StoreBrandView {
  readonly id: BrandId;
  readonly name: string;
  readonly slug: string;
}

/** `ProductSummary` of API_SPEC.md §8.4. */
export interface ProductSummaryView {
  readonly id: ProductId;
  readonly slug: string;
  readonly title: string;
  /** Shown even when the brand is inactive (ADR-0080). */
  readonly brand: StoreBrandView | null;
  /** The lowest current price among its sellable variants; on a tie, the oldest variant's (BR-PRD-15). */
  readonly fromPrice: Money;
  /** The compare-at price of that same variant. */
  readonly compareAtPrice: Money | null;
  /** Some sellable variant is available (ADR-0061). */
  readonly available: boolean;
  /** The first image the store shows, if any. */
  readonly image: ProductImageView | null;
  readonly publishedAt: Date;
}

/** A sellable variant in the store (BR-PRD-11): never its units in stock (ADR-0061). */
export interface StoreVariantView {
  readonly id: VariantId;
  readonly sku: string;
  readonly options: VariantOptions;
  readonly price: Money;
  readonly compareAtPrice: Money | null;
  readonly available: boolean;
}

/** `ProductDetail` of API_SPEC.md §8.5. */
export interface ProductDetailView extends ProductSummaryView {
  readonly description: string | null;
  /** Only the visible ones (ADR-0080), by name. */
  readonly categories: readonly {
    readonly id: CategoryId;
    readonly name: string;
    readonly slug: string;
  }[];
  /**
   * By position, without the images of variants the store does not sell (ADR-0129): their `variantId` would
   * point to a variant the detail leaves out.
   */
  readonly images: readonly ProductImageView[];
  /** In alphabetical order, as the domain compares them. */
  readonly optionNames: readonly string[];
  /** Only sellable variants, oldest first. */
  readonly variants: readonly StoreVariantView[];
}

/**
 * Reads of the public store (ADR-0060). Its adapter is the only code allowed to read tables of Pricing and
 * Inventory, only to read them, so filters and totals by price and availability are exact (ADR-0005). A
 * variant is sellable when its product is published, the variant is active and it has a price current at
 * `at` in the default list (BR-PRD-11); it is available with units not reserved in the active warehouse.
 */
export abstract class StorefrontQueries {
  /** The visible category with this slug and every visible subcategory under it; empty if it is not visible. */
  abstract visibleCategoryTree(slug: string): Promise<CategoryId[]>;

  /** The IDs of the active brands with these slugs; a slug unknown or inactive is left out. */
  abstract activeBrandIds(slugs: readonly string[]): Promise<BrandId[]>;

  /** Published products with a sellable variant that match the criteria; the ID breaks ties. */
  abstract listProducts(
    criteria: StorefrontCriteria,
    page: PageRequest,
    at: Date,
  ): Promise<Page<ProductSummaryView>>;

  /** The published product with this slug, or `null` if there is none or it has no sellable variant. */
  abstract findProduct(
    slug: string,
    at: Date,
  ): Promise<ProductDetailView | null>;

  /** Active brands with a product the store shows, in Spanish order by name (API_SPEC.md §11.5). */
  abstract listBrands(at: Date): Promise<StoreBrandView[]>;

  /** How the store sees each of these products, in the same order; one that does not exist is not published. */
  abstract visibilities(
    ids: readonly ProductId[],
    at: Date,
  ): Promise<StoreVisibility[]>;
}
