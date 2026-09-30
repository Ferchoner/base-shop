import {
  DuplicateValueError,
  InvalidStateTransitionError,
  InvalidValueError,
  newId,
  NotFoundError,
} from '../../../shared-kernel/index.js';
import type { CategoryId } from './category.js';
import { type NewVariant, Product } from './product.js';
import {
  FieldLockedError,
  NoActiveVariantError,
  OptionNamesMismatchError,
} from './product-errors.js';
import type { VariantId } from './variant.js';

const NOW = new Date('2026-09-30T18:00:00.000Z');
const LATER = new Date('2026-10-01T18:00:00.000Z');

const draft = (overrides: Partial<Parameters<typeof Product.create>[0]> = {}) =>
  Product.create({
    id: newId(),
    title: 'Camisa de lino',
    slug: 'camisa-lino',
    description: 'Fresca para el verano.',
    brandId: null,
    categoryIds: [],
    ...overrides,
  });

const variant = (
  sku: string,
  options: Record<string, unknown>,
): NewVariant & { id: VariantId } => ({
  id: newId<'Variant'>(),
  sku,
  options,
  weightGrams: null,
  lengthCm: null,
  widthCm: null,
  heightCm: null,
});

/** A draft with two sizes of one shirt. */
function withSizes() {
  const product = draft();
  const m = variant('cam-m', { Talla: 'M' });
  const l = variant('cam-l', { talla: 'L' });
  product.addVariant(m);
  product.addVariant(l);
  return { product, m: m.id, l: l.id };
}

const published = () => {
  const sizes = withSizes();
  sizes.product.publish(NOW);
  sizes.product.pullEvents();
  return sizes;
};

describe('Product (UC-CAT-04 to 10, ADR-0068, ADR-0076, ADR-0123)', () => {
  describe('creating and editing', () => {
    it('creates a draft without variants, trimming the title', () => {
      const categoryId = newId<'Category'>();
      const product = draft({
        title: '  Camisa de lino  ',
        categoryIds: [categoryId, categoryId],
      });

      expect(product.snapshot()).toMatchObject({
        title: 'Camisa de lino',
        slug: 'camisa-lino',
        status: 'DRAFT',
        publishedAt: null,
        firstPublishedAt: null,
        categoryIds: [categoryId],
        variants: [],
        version: 1,
      });
    });

    it('treats an empty description as no description', () => {
      expect(draft({ description: '   ' }).snapshot().description).toBeNull();
    });

    it.each([
      [{ title: ' ' }],
      [{ title: 't'.repeat(201) }],
      [{ slug: 'Camisa' }],
      [{ slug: 's'.repeat(201) }],
      [{ description: 'd'.repeat(10_001) }],
      [
        {
          categoryIds: Array.from({ length: 11 }, () => newId<'Category'>()),
        },
      ],
    ])('rejects %j', (overrides) => {
      expect(() => draft(overrides as never)).toThrow(InvalidValueError);
    });

    it('accepts a slug of 200 characters and ten categories', () => {
      const categoryIds: CategoryId[] = Array.from({ length: 10 }, () =>
        newId(),
      );

      expect(
        draft({ slug: 's'.repeat(200), categoryIds }).snapshot().categoryIds,
      ).toHaveLength(10);
    });

    it('edits only the given fields', () => {
      const brandId = newId<'Brand'>();
      const product = draft();

      product.editDetails({ title: 'Camisa', brandId, description: null });

      expect(product.snapshot()).toMatchObject({
        title: 'Camisa',
        slug: 'camisa-lino',
        brandId,
        description: null,
      });
    });

    it('fixes the slug from the first publication, even after archiving (ADR-0068)', () => {
      const { product } = published();

      expect(() => product.editDetails({ slug: 'camisa' })).toThrow(
        new FieldLockedError(['slug']),
      );
      product.editDetails({ slug: 'camisa-lino', title: 'Camisa' });
      product.archive(LATER);
      product.reactivate();
      expect(() => product.editDetails({ slug: 'camisa' })).toThrow(
        FieldLockedError,
      );
    });

    it('takes no change while archived', () => {
      const { product, m } = withSizes();
      product.archive(NOW);

      for (const change of [
        () => product.editDetails({ title: 'Otra' }),
        () => product.addVariant(variant('cam-s', { talla: 'S' })),
        () => product.updateVariant(m, { weightGrams: 300 }),
        () => product.discontinueVariant(m, NOW),
        () => product.reactivateVariant(m),
      ]) {
        expect(change).toThrow(InvalidStateTransitionError);
      }
    });
  });

  describe('variants (UC-CAT-06 and 07)', () => {
    it('adds an active variant with its SKU in uppercase and its options normalized', () => {
      const { product, m } = withSizes();

      expect(product.snapshot().variants[0]).toEqual({
        id: m,
        sku: 'CAM-M',
        options: { talla: 'M' },
        status: 'ACTIVE',
        weightGrams: null,
        lengthCm: null,
        widthCm: null,
        heightCm: null,
      });
    });

    it('rejects a SKU the product already has, whatever its case', () => {
      const { product } = withSizes();

      expect(() =>
        product.addVariant(variant('CAM-m', { talla: 'S' })),
      ).toThrow(new DuplicateValueError('sku'));
    });

    it('rejects a combination another active variant has, but not a discontinued one (BR-PRD-02)', () => {
      const { product, m } = withSizes();

      expect(() =>
        product.addVariant(variant('cam-m2', { talla: 'M' })),
      ).toThrow(new DuplicateValueError('options'));
      product.discontinueVariant(m, NOW);
      product.addVariant(variant('cam-m2', { talla: 'M' }));
      expect(product.snapshot().variants).toHaveLength(3);
    });

    it('asks every variant for the same option names, and locks new ones once published', () => {
      const { product } = withSizes();

      expect(() =>
        product.addVariant(variant('cam-azul', { talla: 'M', color: 'Azul' })),
      ).toThrow(OptionNamesMismatchError);
      expect(() => product.addVariant(variant('cam', {}))).toThrow(
        OptionNamesMismatchError,
      );

      product.publish(NOW);
      expect(() =>
        product.addVariant(variant('cam-azul', { color: 'Azul' })),
      ).toThrow(new FieldLockedError(['options']));
      product.addVariant(variant('cam-xl', { talla: 'XL' }));
    });

    it('lets the first variant choose the option names', () => {
      const product = draft();

      product.addVariant(variant('cam', {}));

      expect(product.snapshot().variants[0].options).toEqual({});
    });

    it('edits SKU and options before the first publication, freeing the previous SKU', () => {
      const { product, m } = withSizes();

      product.updateVariant(m, {
        sku: 'cam-med',
        options: { talla: 'Mediana' },
      });
      product.addVariant(variant('cam-m', { talla: 'M' }));

      expect(product.snapshot().variants.map(({ sku }) => sku)).toEqual([
        'CAM-MED',
        'CAM-L',
        'CAM-M',
      ]);
    });

    it('lets the only variant change its option names, but not one of several', () => {
      const single = draft();
      const only = variant('cam', { talla: 'M' });
      single.addVariant(only);
      single.updateVariant(only.id, { options: { color: 'Azul' } });
      const { product, m } = withSizes();

      expect(single.snapshot().variants[0].options).toEqual({ color: 'Azul' });
      expect(() =>
        product.updateVariant(m, { options: { color: 'Azul' } }),
      ).toThrow(OptionNamesMismatchError);
    });

    it('rejects an edit to the SKU or combination of another variant', () => {
      const { product, m } = withSizes();

      expect(() => product.updateVariant(m, { sku: 'CAM-L' })).toThrow(
        new DuplicateValueError('sku'),
      );
      expect(() =>
        product.updateVariant(m, { options: { talla: 'L' } }),
      ).toThrow(new DuplicateValueError('options'));
    });

    it('fixes SKU and options once published, but not the weight and sizes', () => {
      const { product, m } = published();

      expect(() =>
        product.updateVariant(m, { sku: 'X', options: { talla: 'S' } }),
      ).toThrow(new FieldLockedError(['sku', 'options']));
      product.updateVariant(m, {
        sku: 'cam-m',
        options: { talla: 'M' },
        weightGrams: 350,
        lengthCm: 30.1,
      });
      product.updateVariant(m, { lengthCm: null });

      expect(product.snapshot().variants[0]).toMatchObject({
        sku: 'CAM-M',
        weightGrams: 350,
        lengthCm: null,
      });
    });

    it('answers an unknown variant as not found', () => {
      const { product } = withSizes();

      expect(() => product.updateVariant(newId(), { weightGrams: 1 })).toThrow(
        NotFoundError,
      );
    });
  });

  describe('discontinuing and reactivating variants (UC-CAT-08)', () => {
    it('discontinues an active variant with an event, and not twice', () => {
      const { product, m } = published();

      product.discontinueVariant(m, LATER);

      expect(product.snapshot().variants[0].status).toBe('DISCONTINUED');
      expect(product.pullEvents()).toEqual([
        expect.objectContaining({
          eventType: 'VariantDiscontinued',
          occurredAt: LATER,
          productId: product.id,
          variantId: m,
        }),
      ]);
      expect(() => product.discontinueVariant(m, LATER)).toThrow(
        InvalidStateTransitionError,
      );
    });

    it('reactivates a discontinued variant unless another active one has its combination (BR-PRD-13)', () => {
      const { product, m } = withSizes();
      product.discontinueVariant(m, NOW);
      const other = variant('cam-m2', { talla: 'M' });
      product.addVariant(other);

      expect(() => product.reactivateVariant(m)).toThrow(
        new DuplicateValueError('options'),
      );
      product.discontinueVariant(other.id, NOW);
      product.reactivateVariant(m);

      expect(product.snapshot().variants[0].status).toBe('ACTIVE');
      expect(() => product.reactivateVariant(m)).toThrow(
        InvalidStateTransitionError,
      );
    });
  });

  describe('publishing, archiving and reactivating (UC-CAT-09 and 10)', () => {
    it('publishes a draft with an active variant, with an event, and fixes the first publication', () => {
      const { product } = withSizes();

      product.publish(NOW);

      expect(product.snapshot()).toMatchObject({
        status: 'PUBLISHED',
        publishedAt: NOW,
        firstPublishedAt: NOW,
      });
      expect(product.pullEvents()).toEqual([
        expect.objectContaining({
          eventType: 'ProductPublished',
          occurredAt: NOW,
          productId: product.id,
        }),
      ]);
      expect(product.pullEvents()).toEqual([]);
    });

    it('does not publish without an active variant (BR-PRD-04)', () => {
      const empty = draft();
      const { product, m, l } = withSizes();
      product.discontinueVariant(m, NOW);
      product.discontinueVariant(l, NOW);

      expect(() => empty.publish(NOW)).toThrow(NoActiveVariantError);
      expect(() => product.publish(NOW)).toThrow(NoActiveVariantError);
      expect(new NoActiveVariantError().details).toEqual({
        currentStatus: 'DRAFT',
        reason: 'no-active-variant',
      });
    });

    it('publishes only drafts', () => {
      const { product } = published();

      expect(() => product.publish(LATER)).toThrow(InvalidStateTransitionError);
      product.archive(LATER);
      expect(() => product.publish(LATER)).toThrow(InvalidStateTransitionError);
    });

    it('archives a draft or a published product, with an event, and not twice', () => {
      const fresh = draft();
      const { product } = published();

      fresh.archive(NOW);
      product.archive(LATER);

      expect(fresh.status).toBe('ARCHIVED');
      expect(product.snapshot()).toMatchObject({
        status: 'ARCHIVED',
        archivedAt: LATER,
      });
      expect(product.pullEvents()).toEqual([
        expect.objectContaining({ eventType: 'ProductArchived' }),
      ]);
      expect(() => product.archive(LATER)).toThrow(InvalidStateTransitionError);
    });

    it('reactivates an archived product as a draft, keeping its slug and first publication (ADR-0076)', () => {
      const { product } = published();
      product.archive(LATER);

      product.reactivate();
      product.publish(LATER);

      expect(product.snapshot()).toMatchObject({
        status: 'PUBLISHED',
        slug: 'camisa-lino',
        archivedAt: null,
        publishedAt: LATER,
        firstPublishedAt: NOW,
      });
      expect(() => product.reactivate()).toThrow(InvalidStateTransitionError);
    });

    it('comes back as a draft without a publication date', () => {
      const { product } = published();
      product.archive(LATER);

      product.reactivate();

      expect(product.snapshot()).toMatchObject({
        status: 'DRAFT',
        publishedAt: null,
      });
      expect(product.pullEvents()).toEqual([
        expect.objectContaining({ eventType: 'ProductArchived' }),
      ]);
    });
  });

  it('takes the version the repository saved', () => {
    const product = draft();

    product.markSaved(2);

    expect(product.version).toBe(2);
  });
});
