import { NotFoundError } from '../../../shared-kernel/index.js';
import { UnusableParentError } from '../domain/catalog-errors.js';
import type { Category, CategoryId } from '../domain/category.js';
import type { CategoryRepository } from '../domain/category.repository.js';

/** What the audit trail keeps of a category (ADR-0100): its editable fields and status. */
export function auditedFields(category: Category): Record<string, unknown> {
  const { parentId, name, slug, status, position } = category.snapshot();
  return { parentId, name, slug, status, position };
}

export async function findCategory(
  categories: CategoryRepository,
  id: CategoryId,
): Promise<Category> {
  const category = await categories.findById(id);
  if (category === null) throw new NotFoundError('Category', id);
  return category;
}

/** The parent of a new or moved category must exist and be active (API_SPEC.md §11.9). */
export async function assertUsableParent(
  categories: CategoryRepository,
  parentId: CategoryId,
): Promise<void> {
  const parent = await categories.findById(parentId);
  if (parent === null) throw new UnusableParentError('unknown');
  if (parent.status !== 'ACTIVE') throw new UnusableParentError('inactive');
}
