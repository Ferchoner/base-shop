import {
  InvalidStateTransitionError,
  InvalidValueError,
  newId,
} from '../../../shared-kernel/index.js';
import { CategoryCycleError, InactiveParentError } from './catalog-errors.js';
import { Category, type CategoryId, MAX_POSITION } from './category.js';

const create = (
  overrides: Partial<Parameters<typeof Category.create>[0]> = {},
) =>
  Category.create({
    id: newId(),
    parentId: null,
    name: 'Camisas',
    slug: 'camisas',
    position: 0,
    ...overrides,
  });

const inactive = (): Category => {
  const category = create();
  category.deactivate();
  return category;
};

describe('Category (UC-CAT-12, BR-PRD-03, BR-PRD-13)', () => {
  it('creates an active category with a trimmed name', () => {
    const parentId = newId<'Category'>();
    const category = create({ name: '  Camisas  ', parentId, position: 3 });

    expect(category.snapshot()).toMatchObject({
      parentId,
      name: 'Camisas',
      slug: 'camisas',
      status: 'ACTIVE',
      position: 3,
    });
  });

  it.each(['', '   ', 'a'.repeat(101)])('rejects the name "%s"', (name) => {
    expect(() => create({ name })).toThrow(InvalidValueError);
    expect(() => create().rename(name)).toThrow(InvalidValueError);
  });

  it('rejects a slug with another format', () => {
    expect(() => create({ slug: 'Camisas' })).toThrow(InvalidValueError);
    expect(() => create().changeSlug('camisas de vestir')).toThrow(
      InvalidValueError,
    );
  });

  it.each([-1, MAX_POSITION + 1, 1.5])(
    'rejects the position %p',
    (position) => {
      expect(() => create({ position })).toThrow(InvalidValueError);
      expect(() => create().reposition(position)).toThrow(InvalidValueError);
    },
  );

  it('renames, changes the slug and repositions', () => {
    const category = create();

    category.rename('Playeras');
    category.changeSlug('playeras');
    category.reposition(MAX_POSITION);

    expect(category.snapshot()).toMatchObject({
      name: 'Playeras',
      slug: 'playeras',
      position: MAX_POSITION,
    });
  });

  describe('moving (BR-PRD-03)', () => {
    it('moves under another category or to the root', () => {
      const category = create({ parentId: newId() });
      const parentId = newId<'Category'>();

      category.moveUnder(parentId, [parentId, newId()]);
      expect(category.parentId).toBe(parentId);

      category.moveUnder(null, []);
      expect(category.parentId).toBeNull();
    });

    it('never moves under itself', () => {
      const category = create();

      expect(() => category.moveUnder(category.id, [category.id])).toThrow(
        CategoryCycleError,
      );
      // Even if the lineage were read before the category existed.
      expect(() => category.moveUnder(category.id, [])).toThrow(
        CategoryCycleError,
      );
    });

    it('never moves under one of its subcategories', () => {
      const category = create();
      const grandchild = newId<'Category'>();
      const lineage: CategoryId[] = [grandchild, newId(), category.id];

      expect(() => category.moveUnder(grandchild, lineage)).toThrow(
        CategoryCycleError,
      );
      expect(category.parentId).toBeNull();
    });

    it('answers a cycle as a conflict with its reason', () => {
      const error = new CategoryCycleError();

      expect(error.code).toBe('invalid-state-transition');
      expect(error.category).toBe('conflict');
      expect(error.details).toEqual({ reason: 'category-cycle' });
    });
  });

  describe('status (ADR-0076, ADR-0080)', () => {
    it('deactivates an active category only', () => {
      const category = inactive();

      expect(category.status).toBe('INACTIVE');
      expect(() => category.deactivate()).toThrow(InvalidStateTransitionError);
    });

    it('reactivates a root category, or one under an active parent', () => {
      const root = inactive();
      const child = inactive();

      root.reactivate(null);
      child.reactivate('ACTIVE');

      expect(root.status).toBe('ACTIVE');
      expect(child.status).toBe('ACTIVE');
    });

    it('does not reactivate under an inactive parent, and says why', () => {
      const category = inactive();

      expect(() => category.reactivate('INACTIVE')).toThrow(
        InactiveParentError,
      );
      expect(category.status).toBe('INACTIVE');
      expect(new InactiveParentError().details).toEqual({
        currentStatus: 'INACTIVE',
        reason: 'inactive-parent',
      });
    });

    it('does not reactivate an active category', () => {
      expect(() => create().reactivate(null)).toThrow(
        InvalidStateTransitionError,
      );
    });
  });
});
