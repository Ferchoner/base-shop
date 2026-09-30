import type { CatalogStatus } from '../domain/catalog-values.js';
import { visibleCategoryIds } from '../domain/category-visibility.js';
import type { CategoryView } from './catalog.queries.js';

export type CategoryTree = CategoryView & { readonly children: CategoryTree[] };

/** Siblings by `position`, then by name as Spanish sorts it, then by ID so the order never changes. */
const collator = new Intl.Collator('es', { sensitivity: 'base' });

/** The tree of the store: only visible categories (UC-CAT-03, BR-PRD-17, ADR-0080). */
export function publicCategoryTree(
  categories: readonly CategoryView[],
): CategoryTree[] {
  return treeOf(categories, visibleCategoryIds(categories));
}

/**
 * The tree of the administration, with inactive categories (API_SPEC.md §11.9). With `statuses`, it keeps
 * the categories in those statuses and the ancestors that lead to them, each with its own status, so no
 * branch is lost (ADR-0120).
 */
export function adminCategoryTree(
  categories: readonly CategoryView[],
  statuses?: readonly CatalogStatus[],
): CategoryTree[] {
  if (statuses === undefined) {
    return treeOf(categories, new Set(categories.map(({ id }) => id)));
  }
  const byId = new Map(categories.map((category) => [category.id, category]));
  const kept = new Set<string>();
  for (const category of categories) {
    if (!statuses.includes(category.status)) continue;
    let current: CategoryView | undefined = category;
    while (current !== undefined && !kept.has(current.id)) {
      kept.add(current.id);
      current =
        current.parentId === null ? undefined : byId.get(current.parentId);
    }
  }
  return treeOf(categories, kept);
}

/** The kept categories as a tree; each one's parent is kept too, or it is a root. */
function treeOf(
  categories: readonly CategoryView[],
  kept: ReadonlySet<string>,
): CategoryTree[] {
  const childrenOf = new Map<string | null, CategoryView[]>();
  for (const category of categories) {
    if (!kept.has(category.id)) continue;
    const siblings = childrenOf.get(category.parentId) ?? [];
    siblings.push(category);
    childrenOf.set(category.parentId, siblings);
  }
  const build = (parentId: string | null): CategoryTree[] =>
    (childrenOf.get(parentId) ?? [])
      .sort(
        (a, b) =>
          a.position - b.position ||
          collator.compare(a.name, b.name) ||
          a.id.localeCompare(b.id),
      )
      .map((category) => ({ ...category, children: build(category.id) }));
  return build(null);
}
