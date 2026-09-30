import type {
  AdminProductView,
  BrandView,
  CategoryView,
} from '../application/catalog.queries.js';
import type { CategoryTree } from '../application/category-trees.js';
import type {
  AdminBrandDto,
  AdminCategoryDto,
  AdminCategoryNodeDto,
} from './catalog-admin.dto.js';
import type { AdminProductDto } from './catalog-product.dto.js';
import type { PublicCategoryDto } from './catalog.dto.js';

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
 * tells whether SKUs and options can still change (ADR-0068).
 */
export function toAdminProductDto(
  view: AdminProductView,
  urlOf: (storageKey: string) => string,
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
    variants: view.variants.map((variant) => ({
      ...variant,
      options: { ...variant.options },
      editableIdentity,
    })),
    images: view.images.map(({ storageKey, ...image }) => ({
      ...image,
      url: urlOf(storageKey),
    })),
    publishedAt: view.publishedAt,
    firstPublishedAt: view.firstPublishedAt,
    archivedAt: view.archivedAt,
    version: view.version,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
  };
}
