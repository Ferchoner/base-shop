import { toId } from '../../../shared-kernel/index.js';
import type { CatalogStatus } from '../domain/catalog-values.js';
import type { CategoryView } from './catalog.queries.js';
import {
  adminCategoryTree,
  type CategoryTree,
  publicCategoryTree,
} from './category-trees.js';

/** Readable UUIDs: the number goes in the last group, so it also sets the order by ID. */
const id = (n: number) =>
  toId<'Category'>(`00000000-0000-4000-8000-${String(n).padStart(12, '0')}`);

const view = (
  n: number,
  name: string,
  parent: number | null,
  options: { status?: CatalogStatus; position?: number } = {},
): CategoryView => ({
  id: id(n),
  parentId: parent === null ? null : id(parent),
  name,
  slug: name.toLowerCase(),
  status: options.status ?? 'ACTIVE',
  position: options.position ?? 0,
  productCount: 0,
  childCount: 0,
  createdAt: new Date('2026-09-30T12:00:00Z'),
  updatedAt: new Date('2026-09-30T12:00:00Z'),
});

/** The tree as names, to compare its shape. */
const names = (trees: CategoryTree[]): unknown[] =>
  trees.map((tree) =>
    tree.children.length === 0
      ? tree.name
      : { [tree.name]: names(tree.children) },
  );

describe('Category trees (UC-CAT-03, UC-CAT-12, ADR-0120)', () => {
  const categories = [
    view(1, 'Ropa', null),
    view(2, 'Camisas', 1, { status: 'INACTIVE' }),
    view(3, 'Manga larga', 2),
    view(4, 'Pantalones', 1),
    view(5, 'Hogar', null, { status: 'INACTIVE' }),
    view(6, 'Cocina', 5, { status: 'INACTIVE' }),
    view(7, 'Baño', 5),
  ];

  describe('publicCategoryTree', () => {
    it('keeps only visible categories: an inactive one hides its whole subtree (BR-PRD-17)', () => {
      expect(names(publicCategoryTree(categories))).toEqual([
        { Ropa: ['Pantalones'] },
      ]);
    });

    it('orders siblings by position, then by name as Spanish sorts it, then by ID', () => {
      const tree = publicCategoryTree([
        view(10, 'Zapatos', null, { position: 0 }),
        view(11, 'Ñandú', null, { position: 1 }),
        view(12, 'nieve', null, { position: 1 }),
        view(13, 'Árboles', null, { position: 1 }),
        view(14, 'Ofertas', null, { position: 2 }),
        // The same name but for its case: the ID decides, not the case.
        view(16, 'duplicada', null, { position: 3 }),
        view(15, 'Duplicada', null, { position: 3 }),
      ]);

      expect(names(tree)).toEqual([
        'Zapatos',
        'Árboles',
        'nieve',
        'Ñandú',
        'Ofertas',
        'Duplicada',
        'duplicada',
      ]);
    });

    it('keeps every field of each category, with its children', () => {
      const [ropa] = publicCategoryTree(categories);

      expect(ropa).toEqual({
        ...categories[0],
        children: [{ ...categories[3], children: [] }],
      });
    });
  });

  describe('adminCategoryTree', () => {
    it('keeps every category without a filter', () => {
      expect(names(adminCategoryTree(categories))).toEqual([
        { Hogar: ['Baño', 'Cocina'] },
        { Ropa: [{ Camisas: ['Manga larga'] }, 'Pantalones'] },
      ]);
    });

    it('keeps the ancestors of each category that matches, so no branch is lost', () => {
      const active = adminCategoryTree(categories, ['ACTIVE']);
      const inactive = adminCategoryTree(categories, ['INACTIVE']);

      expect(names(active)).toEqual([
        { Hogar: ['Baño'] },
        { Ropa: [{ Camisas: ['Manga larga'] }, 'Pantalones'] },
      ]);
      expect(names(inactive)).toEqual([
        { Hogar: ['Cocina'] },
        { Ropa: ['Camisas'] },
      ]);
      // Each ancestor keeps its own status.
      expect(inactive[1].status).toBe('ACTIVE');
    });

    it('keeps nothing when no category matches', () => {
      expect(adminCategoryTree([view(1, 'Ropa', null)], ['INACTIVE'])).toEqual(
        [],
      );
    });
  });
});
