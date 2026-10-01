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
