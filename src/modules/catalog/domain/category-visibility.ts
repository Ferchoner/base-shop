import type { CatalogStatus } from './catalog-values.js';

export interface CategoryNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly status: CatalogStatus;
}

/**
 * The categories visible in the store: active, with every ancestor active (BR-PRD-17, ADR-0080). Deactivating
 * a category hides its whole subtree, although its subcategories stay active.
 */
export function visibleCategoryIds(
  categories: readonly CategoryNode[],
): Set<string> {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const visibility = new Map<string, boolean>();

  const isVisible = (id: string, path: Set<string>): boolean => {
    const known = visibility.get(id);
    if (known !== undefined) return known;
    const category = byId.get(id);
    // A missing parent or a cycle cannot happen with the foreign key and BR-PRD-03; hidden if they did.
    if (category === undefined || path.has(id)) return false;
    path.add(id);
    const visible =
      category.status === 'ACTIVE' &&
      (category.parentId === null || isVisible(category.parentId, path));
    visibility.set(id, visible);
    return visible;
  };

  return new Set(
    categories
      .filter((category) => isVisible(category.id, new Set()))
      .map((category) => category.id),
  );
}
