import { toMoneyDto } from '../../../platform/http/money.dto.js';
import type { Money } from '../../../shared-kernel/index.js';
import type {
  AdminProductView,
  BrandView,
  CategoryView,
  ProductImageView,
} from '../application/catalog.queries.js';
import type { CategoryTree } from '../application/category-trees.js';
import type {
  ProductDetailView,
  ProductSummaryView,
  StoreBrandView,
  StoreVisibility,
} from '../application/storefront.queries.js';
import type {
  AdminBrandDto,
  AdminCategoryDto,
  AdminCategoryNodeDto,
} from './catalog-admin.dto.js';
import type { AdminProductDto, ImageDto } from './catalog-product.dto.js';
import type {
  ProductDetailDto,
  ProductSummaryDto,
  PublicCategoryDto,
  StoreBrandDto,
} from './catalog.dto.js';

/** Builds the absolute URL of an image from its storage key (ADR-0024). */
type UrlOf = (storageKey: string) => string;

/** Only what the store shows of a category (API_SPEC.md §11.4): never its status or counts. */
export function toPublicCategoryDto(tree: CategoryTree): PublicCategoryDto {
  return {
    id: tree.id,
    name: tree.name,
    slug: tree.slug,
    position: tree.position,
    children: tree.children.map(toPublicCategoryDto),
  };
}

export function toAdminCategoryDto(view: CategoryView): AdminCategoryDto {
  return {
    id: view.id,
    parentId: view.parentId,
    name: view.name,
    slug: view.slug,
    status: view.status,
    position: view.position,
    productCount: view.productCount,
    childCount: view.childCount,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
  };
}

export function toAdminCategoryNodeDto(
  tree: CategoryTree,
): AdminCategoryNodeDto {
  return {
    ...toAdminCategoryDto(tree),
    children: tree.children.map(toAdminCategoryNodeDto),
  };
}

export function toAdminBrandDto(view: BrandView): AdminBrandDto {
  return { ...view };
}

/**
 * `AdminProduct` of API_SPEC.md §11.6. Image URLs are built from their keys (ADR-0024); `editableIdentity`
 * tells whether SKUs and options can still change (ADR-0068), and `storeVisibility` whether the store shows
 * the product (ADR-0129).
 */
export function toAdminProductDto(
  view: AdminProductView,
  urlOf: UrlOf,
  storeVisibility: StoreVisibility,
): AdminProductDto {
  const editableIdentity = view.firstPublishedAt === null;
  return {
    id: view.id,
    title: view.title,
    slug: view.slug,
    ...(view.description === undefined
      ? {}
      : { description: view.description }),
    brand: view.brand,
    categories: view.categories.map(({ id, name }) => ({ id, name })),
    status: view.status,
    storeVisibility,
    variants: view.variants.map((variant) => ({
      ...variant,
      options: { ...variant.options },
      editableIdentity,
    })),
    images: view.images.map((image) => toImageDto(image, urlOf)),
    publishedAt: view.publishedAt,
    firstPublishedAt: view.firstPublishedAt,
    archivedAt: view.archivedAt,
    version: view.version,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
  };
}

function toImageDto(
  { storageKey, ...image }: ProductImageView,
  urlOf: UrlOf,
): ImageDto {
  return { ...image, url: urlOf(storageKey) };
}

function toNullableMoneyDto(money: Money | null) {
  return money === null ? null : toMoneyDto(money);
}

export function toStoreBrandDto(view: StoreBrandView): StoreBrandDto {
  return { id: view.id, name: view.name, slug: view.slug };
}

/** `ProductSummary` of API_SPEC.md §8.4. */
export function toProductSummaryDto(
  view: ProductSummaryView,
  urlOf: UrlOf,
): ProductSummaryDto {
  return {
    id: view.id,
    slug: view.slug,
    title: view.title,
    brand: view.brand === null ? null : toStoreBrandDto(view.brand),
    fromPrice: toMoneyDto(view.fromPrice),
    compareAtPrice: toNullableMoneyDto(view.compareAtPrice),
    available: view.available,
    image: view.image === null ? null : toImageDto(view.image, urlOf),
    publishedAt: view.publishedAt,
  };
}

/** `ProductDetail` of API_SPEC.md §8.5: never units in stock (ADR-0061). */
export function toProductDetailDto(
  view: ProductDetailView,
  urlOf: UrlOf,
): ProductDetailDto {
  return {
    ...toProductSummaryDto(view, urlOf),
    description: view.description,
    categories: view.categories.map(({ id, name, slug }) => ({
      id,
      name,
      slug,
    })),
    images: view.images.map((image) => toImageDto(image, urlOf)),
    optionNames: [...view.optionNames],
    variants: view.variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      options: { ...variant.options },
      price: toMoneyDto(variant.price),
      compareAtPrice: toNullableMoneyDto(variant.compareAtPrice),
      available: variant.available,
    })),
  };
}
