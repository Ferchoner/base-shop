import type { CatalogStatus } from './catalog-values.js';
import { visibleCategoryIds } from './category-visibility.js';

const node = (id: string, parentId: string | null, status: CatalogStatus) => ({
  id,
  parentId,
  status,
});

describe('visibleCategoryIds (BR-PRD-17, ADR-0080)', () => {
  it('shows active categories whose every ancestor is active', () => {
    const visible = visibleCategoryIds([
      node('ropa', null, 'ACTIVE'),
      node('camisas', 'ropa', 'ACTIVE'),
      node('manga-larga', 'camisas', 'ACTIVE'),
    ]);

    expect([...visible].sort()).toEqual(['camisas', 'manga-larga', 'ropa']);
  });

  it('hides an inactive category and its whole subtree, although the subcategories stay active', () => {
    const visible = visibleCategoryIds([
      node('manga-larga', 'camisas', 'ACTIVE'),
      node('camisas', 'ropa', 'INACTIVE'),
      node('ropa', null, 'ACTIVE'),
      node('pantalones', 'ropa', 'ACTIVE'),
    ]);

    expect([...visible].sort()).toEqual(['pantalones', 'ropa']);
  });

  it('hides a category under an inactive root', () => {
    const visible = visibleCategoryIds([
      node('ropa', null, 'INACTIVE'),
      node('camisas', 'ropa', 'ACTIVE'),
    ]);

    expect(visible.size).toBe(0);
  });

  it('hides categories whose parent is missing or that form a cycle, which the database never allows', () => {
    const visible = visibleCategoryIds([
      node('huerfana', 'no-existe', 'ACTIVE'),
      node('a', 'b', 'ACTIVE'),
      node('b', 'a', 'ACTIVE'),
    ]);

    expect(visible.size).toBe(0);
  });
});
