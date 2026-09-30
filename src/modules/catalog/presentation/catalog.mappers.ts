import type {
  BrandView,
  CategoryView,
} from '../application/catalog.queries.js';
import type { CategoryTree } from '../application/category-trees.js';
import type {
  AdminBrandDto,
  AdminCategoryDto,
  AdminCategoryNodeDto,
} from './catalog-admin.dto.js';
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
