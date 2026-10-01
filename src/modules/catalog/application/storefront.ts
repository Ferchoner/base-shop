import { Injectable } from '@nestjs/common';
import {
  Clock,
  NotFoundError,
  type Page,
  type PageRequest,
} from '../../../shared-kernel/index.js';
import type { BrandId } from '../domain/brand.js';
import type { CategoryId } from '../domain/category.js';
import type { ProductId } from '../domain/product-id.js';
import {
  UnknownBrandsFilterError,
  UnknownCategoryFilterError,
} from '../domain/product-errors.js';
import { MAX_PRODUCT_SLUG_LENGTH, SLUG_PATTERN } from '../domain/slug.js';
import {
  type ProductDetailView,
  type ProductSummaryView,
  type StoreBrandView,
  StorefrontQueries,
  type StorefrontSort,
  type StoreVisibility,
} from './storefront.queries.js';

/** What a shopper asks the store listing for (API_SPEC.md §11.2), already checked by the API. */
export interface StoreSearch {
  readonly q?: string;
  /** Slug of a category. */
  readonly category?: string;
  /** Slugs of brands. */
  readonly brands?: readonly string[];
  readonly minPrice?: number;
  readonly maxPrice?: number;
  readonly availableOnly: boolean;
  /** By default, `relevance` with `q` and `-publishedAt` without it. */
  readonly sort?: StorefrontSort;
}

/**
 * The words of a search text: runs of letters and digits, so punctuation never reaches the text search
 * query (ADR-0129). PostgreSQL removes the accents and the stems, as it did for `search_vector`.
 */
export function searchWords(text: string): string[] {
  return text.match(/[\p{L}\p{N}]+/gu) ?? [];
}

/**
 * The public store (UC-CAT-01 and 02, ADR-0060): the listing, the detail and the brands, at the current time
 * of the server, so a scheduled price shows up when it starts without any job. It also tells the staff how
 * the store sees each product (UC-CAT-14).
 */
@Injectable()
export class Storefront {
  constructor(
    private readonly queries: StorefrontQueries,
    private readonly clock: Clock,
  ) {}

  /**
   * @throws UnknownCategoryFilterError when the category does not exist or is hidden (ADR-0080).
   * @throws UnknownBrandsFilterError when a brand does not exist or is inactive.
   */
  async products(
    search: StoreSearch,
    page: PageRequest,
  ): Promise<Page<ProductSummaryView>> {
    const categoryIds =
      search.category === undefined
        ? undefined
        : await this.categoryTree(search.category);
    const brandIds =
      search.brands === undefined
        ? undefined
        : await this.brandIds(search.brands);
    const words = search.q === undefined ? undefined : searchWords(search.q);
    // A text without letters or digits, such as "!!", finds nothing.
    if (words?.length === 0) return { items: [], totalItems: 0 };
    return this.queries.listProducts(
      {
        words,
        categoryIds,
        brandIds,
        minPrice: search.minPrice,
        maxPrice: search.maxPrice,
        availableOnly: search.availableOnly,
        sort:
          search.sort ?? (words === undefined ? '-publishedAt' : 'relevance'),
      },
      page,
      this.clock.now(),
    );
  }

  /** @throws NotFoundError when the product does not exist, is not published or has no sellable variant. */
  async product(slug: string): Promise<ProductDetailView> {
    // A slug that no product could have is not looked up.
    const product =
      SLUG_PATTERN.test(slug) && slug.length <= MAX_PRODUCT_SLUG_LENGTH
        ? await this.queries.findProduct(slug, this.clock.now())
        : null;
    if (product === null) throw new NotFoundError('Product', slug);
    return product;
  }

  brands(): Promise<StoreBrandView[]> {
    return this.queries.listBrands(this.clock.now());
  }

  /** How the store sees each product right now, in the same order (`storeVisibility`, API_SPEC.md §11.6). */
  async visibilities(ids: readonly ProductId[]): Promise<StoreVisibility[]> {
    if (ids.length === 0) return [];
    return this.queries.visibilities(ids, this.clock.now());
  }

  private async categoryTree(slug: string): Promise<CategoryId[]> {
    const ids = await this.queries.visibleCategoryTree(slug);
    if (ids.length === 0) throw new UnknownCategoryFilterError();
    return ids;
  }

  private async brandIds(slugs: readonly string[]): Promise<BrandId[]> {
    const unique = [...new Set(slugs)];
    const ids = await this.queries.activeBrandIds(unique);
    if (ids.length < unique.length) throw new UnknownBrandsFilterError();
    return ids;
  }
}
