import { newId } from '../../../shared-kernel/index.js';
import type { VariantId } from '../domain/variant.js';
import { CatalogFacade } from './catalog.facade.js';
import { CatalogQueries, type VariantSnapshot } from './catalog.queries.js';
import type { ProductImageStorage } from './product-image-storage.js';

const images = {
  urlOf: (key: string) => `https://cdn.example.com/${key}`,
} as unknown as ProductImageStorage;

/** Remembers which variants it was asked for, by ID or by SKU; only those two queries are used. */
function queriesAnswering(snapshots: VariantSnapshot[]) {
  const asked: string[][] = [];
  const queries = {
    findVariants: (ids: readonly VariantId[]) => {
      asked.push([...ids]);
      return Promise.resolve(snapshots.filter(({ id }) => ids.includes(id)));
    },
    findVariantsBySku: (skus: readonly string[]) => {
      asked.push([...skus]);
      return Promise.resolve(snapshots.filter(({ sku }) => skus.includes(sku)));
    },
  } as unknown as CatalogQueries;
  return { queries, asked };
}

describe('CatalogFacade (ADR-0005, ADR-0125)', () => {
  const snapshot: VariantSnapshot = {
    id: newId<'Variant'>(),
    productId: newId<'Product'>(),
    productSlug: 'camisa-de-lino',
    productTitle: 'Camisa de lino',
    productStatus: 'DRAFT',
    sku: 'CAM-LINO-M',
    options: { talla: 'm' },
    status: 'DISCONTINUED',
    weightGrams: null,
    lengthCm: null,
    widthCm: null,
    heightCm: null,
  };

  it('answers the variants that exist, in any status, asking each one once', async () => {
    const { queries, asked } = queriesAnswering([snapshot]);
    const missing = newId<'Variant'>();

    expect(
      await new CatalogFacade(queries, images).variants([
        snapshot.id,
        missing,
        snapshot.id,
      ]),
    ).toEqual([snapshot]);
    expect(asked).toEqual([[snapshot.id, missing]]);
  });

  it('asks nothing for no variants', async () => {
    const { queries, asked } = queriesAnswering([snapshot]);

    expect(await new CatalogFacade(queries, images).variants([])).toEqual([]);
    expect(await new CatalogFacade(queries, images).variantsBySku([])).toEqual(
      [],
    );
    expect(asked).toEqual([]);
  });

  it('finds variants by SKU whatever their case, asking each SKU once in uppercase (ADR-0126)', async () => {
    const { queries, asked } = queriesAnswering([snapshot]);

    expect(
      await new CatalogFacade(queries, images).variantsBySku([
        'cam-lino-m',
        'CAM-LINO-M',
        'gorra',
      ]),
    ).toEqual([snapshot]);
    expect(asked).toEqual([['CAM-LINO-M', 'GORRA']]);
  });
});

describe('CatalogFacade.variantsWithImage (T-170, ADR-0131)', () => {
  const productId = newId<'Product'>();
  const otherProduct = newId<'Product'>();
  const [blue, red, plain] = [
    newId<'Variant'>(),
    newId<'Variant'>(),
    newId<'Variant'>(),
  ];
  const variant = (id: VariantId, product = productId): VariantSnapshot => ({
    id,
    productId: product,
    productSlug: 'camisa',
    productTitle: 'Camisa',
    productStatus: 'PUBLISHED',
    sku: `SKU-${id.slice(-4)}`,
    options: {},
    status: 'ACTIVE',
    weightGrams: null,
    lengthCm: null,
    widthCm: null,
    heightCm: null,
  });
  const image = (
    id: string,
    position: number,
    variantId: VariantId | null,
    product = productId,
  ) => ({
    id,
    productId: product,
    storageKey: `products/${product}/${id}.jpg`,
    altText: `Imagen ${id}`,
    position,
    variantId,
  });

  /** Answers the variants and, by position, the images of the products it is asked for. */
  function queriesWith(
    snapshots: VariantSnapshot[],
    images: ReturnType<typeof image>[],
  ) {
    const askedImages: string[][] = [];
    const queries = {
      findVariants: (ids: readonly VariantId[]) =>
        Promise.resolve(snapshots.filter(({ id }) => ids.includes(id))),
      findImagesOfProducts: (ids: readonly string[]) => {
        askedImages.push([...ids]);
        return Promise.resolve(
          images
            .filter((candidate) => ids.includes(candidate.productId))
            .sort((a, b) => a.position - b.position),
        );
      },
    } as unknown as CatalogQueries;
    return { queries, askedImages };
  }

  it('takes the first image of the variant, or else the first image of its product that belongs to no variant', async () => {
    const { queries, askedImages } = queriesWith(
      [variant(blue), variant(red), variant(plain, otherProduct)],
      [
        image('general-2', 2, null),
        image('red-3', 3, red),
        image('blue-4', 4, blue),
        image('blue-1', 1, blue),
        image('other', 1, null, otherProduct),
      ],
    );

    const answer = await new CatalogFacade(queries, images).variantsWithImage([
      blue,
      red,
      plain,
    ]);

    expect(answer.map(({ id, image }) => [id, image?.id])).toEqual([
      [blue, 'blue-1'],
      [red, 'red-3'],
      [plain, 'other'],
    ]);
    expect(answer[0].image).toEqual({
      id: 'blue-1',
      url: `https://cdn.example.com/products/${productId}/blue-1.jpg`,
      altText: 'Imagen blue-1',
      position: 1,
      variantId: blue,
    });
    expect(askedImages).toEqual([[productId, otherProduct]]);
  });

  it('never takes the image of another variant, nor of another product', async () => {
    const { queries } = queriesWith(
      [variant(blue), variant(plain, otherProduct)],
      [image('red', 1, red), image('general', 1, null)],
    );

    const answer = await new CatalogFacade(queries, images).variantsWithImage([
      blue,
      plain,
    ]);

    expect(answer.map(({ image }) => image?.id ?? null)).toEqual([
      'general',
      null,
    ]);
  });

  it('asks for no images when no variant exists', async () => {
    const { queries, askedImages } = queriesWith([], []);

    expect(
      await new CatalogFacade(queries, images).variantsWithImage([
        newId<'Variant'>(),
      ]),
    ).toEqual([]);
    expect(askedImages).toEqual([]);
  });
});
