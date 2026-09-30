import {
  InvalidStateTransitionError,
  InvalidValueError,
  newId,
  NotFoundError,
} from '../../../shared-kernel/index.js';
import type { ProductStatus } from './product.js';
import {
  ImageLimitReachedError,
  ImageOrderError,
  MAX_IMAGES_PER_PRODUCT,
  type NewGalleryImage,
  ProductGallery,
  type ProductImageId,
  UnknownVariantError,
} from './product-gallery.js';
import type { VariantId } from './variant.js';

const variantId = newId<'Variant'>();

const gallery = (status: ProductStatus = 'DRAFT') =>
  ProductGallery.of({
    productId: newId(),
    productStatus: status,
    variantIds: [variantId],
    images: [],
  });

const newImage = (
  overrides: Partial<NewGalleryImage> = {},
): NewGalleryImage => {
  const id = newId<'ProductImage'>();
  return {
    id,
    storageKey: `products/${newId()}/${id}.jpg`,
    contentType: 'image/jpeg',
    sizeBytes: 1_024,
    altText: null,
    variantId: null,
    ...overrides,
  };
};

/** A gallery with three images, and their IDs in order. */
function withThree() {
  const images = gallery();
  const ids = [newImage(), newImage(), newImage()].map(
    (image) => images.add(image).id,
  );
  return { images, ids };
}

const order = (images: ProductGallery) =>
  images.images().map(({ id, position }) => ({ id, position }));

describe('ProductGallery (UC-CAT-11, ADR-0124)', () => {
  it('adds images at the end, from position 1', () => {
    const { images, ids } = withThree();

    expect(order(images)).toEqual([
      { id: ids[0], position: 1 },
      { id: ids[1], position: 2 },
      { id: ids[2], position: 3 },
    ]);
  });

  it('keeps the alternative text trimmed, and an empty one as none', () => {
    const images = gallery();

    expect(images.add(newImage({ altText: '  Vista frontal  ' })).altText).toBe(
      'Vista frontal',
    );
    expect(images.add(newImage({ altText: '   ' })).altText).toBeNull();
    expect(() => images.add(newImage({ altText: 'a'.repeat(201) }))).toThrow(
      InvalidValueError,
    );
  });

  it(`keeps at most ${MAX_IMAGES_PER_PRODUCT} images`, () => {
    const images = gallery();
    for (let n = 0; n < MAX_IMAGES_PER_PRODUCT; n += 1) {
      images.add(newImage());
    }

    expect(() => images.add(newImage())).toThrow(ImageLimitReachedError);
    expect(images.images()).toHaveLength(MAX_IMAGES_PER_PRODUCT);
    expect(new ImageLimitReachedError()).toMatchObject({
      code: 'image-limit-reached',
      category: 'conflict',
      details: { limit: MAX_IMAGES_PER_PRODUCT },
    });
  });

  it('shows a variant of its product only, on the variantId field', () => {
    const images = gallery();

    expect(images.add(newImage({ variantId })).variantId).toBe(variantId);
    expect(() =>
      images.add(newImage({ variantId: newId<'Variant'>() as VariantId })),
    ).toThrow(UnknownVariantError);
    expect(new UnknownVariantError().details).toEqual({
      errors: [
        expect.objectContaining({ field: 'variantId', code: 'unknownVariant' }),
      ],
    });
  });

  it('changes the alternative text and the variant, keeping what is not given', () => {
    const images = gallery();
    const { id } = images.add(newImage({ altText: 'Frente' }));

    const withVariant = images.describe(id, { variantId });
    const withoutText = images.describe(id, { altText: null });

    expect(withVariant).toMatchObject({ altText: 'Frente', variantId });
    expect(withoutText).toMatchObject({ altText: null, variantId });
    expect(() =>
      images.describe(id, { variantId: newId<'Variant'>() as VariantId }),
    ).toThrow(UnknownVariantError);
    expect(() => images.describe(newId(), { altText: 'x' })).toThrow(
      NotFoundError,
    );
  });

  it('reorders with every image once, renumbering from 1', () => {
    const { images, ids } = withThree();

    images.reorder([ids[2], ids[0], ids[1]]);

    expect(order(images)).toEqual([
      { id: ids[2], position: 1 },
      { id: ids[0], position: 2 },
      { id: ids[1], position: 3 },
    ]);
  });

  it.each([
    ['one missing', (ids: ProductImageId[]) => [ids[0], ids[1]]],
    ['one repeated', (ids: ProductImageId[]) => [ids[0], ids[1], ids[1]]],
    [
      'one of another product',
      (ids: ProductImageId[]) => [ids[0], ids[1], newId<'ProductImage'>()],
    ],
    ['one extra', (ids: ProductImageId[]) => [...ids, newId<'ProductImage'>()]],
  ])('rejects an order with %s, on the imageIds field', (_, orderOf) => {
    const { images, ids } = withThree();

    expect(() => images.reorder(orderOf(ids))).toThrow(ImageOrderError);
    expect(order(images).map(({ id }) => id)).toEqual(ids);
  });

  it('removes an image and closes the gap it leaves', () => {
    const { images, ids } = withThree();

    const removed = images.remove(ids[0]);

    expect(removed.id).toBe(ids[0]);
    expect(order(images)).toEqual([
      { id: ids[1], position: 1 },
      { id: ids[2], position: 2 },
    ]);
    expect(() => images.remove(ids[0])).toThrow(NotFoundError);
  });

  it('keeps the stored order when restored', () => {
    const [first, second] = [newImage(), newImage()];
    const images = ProductGallery.of({
      productId: newId(),
      productStatus: 'PUBLISHED',
      variantIds: [],
      images: [
        { ...second, position: 2 },
        { ...first, position: 1 },
      ],
    });

    expect(images.images().map(({ id }) => id)).toEqual([first.id, second.id]);
  });

  it('takes no change while the product is archived (ADR-0123)', () => {
    const archived = ProductGallery.of({
      productId: newId(),
      productStatus: 'ARCHIVED',
      variantIds: [],
      images: [{ ...newImage(), position: 1 }],
    });
    const [only] = archived.images();

    for (const change of [
      () => archived.add(newImage()),
      () => archived.describe(only.id, { altText: 'x' }),
      () => archived.reorder([only.id]),
      () => archived.remove(only.id),
    ]) {
      expect(change).toThrow(InvalidStateTransitionError);
    }
  });
});
