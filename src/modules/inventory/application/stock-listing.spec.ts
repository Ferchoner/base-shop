import {
  newId,
  NotFoundError,
  type Page,
  type PageRequest,
  type SortOrder,
} from '../../../shared-kernel/index.js';
import type { StockLevel, StockMovement, VariantId } from '../domain/stock.js';
import { CatalogVariants, type VariantLabel } from './catalog-variants.js';
import {
  InventoryQueries,
  type MovementPosition,
  type StockFilter,
  type WarehouseView,
} from './inventory.queries.js';
import { StockListing } from './stock-listing.js';

const warehouseId = newId<'Warehouse'>();

function stock(
  variantId: VariantId,
  onHand: number,
  reserved: number,
  updatedAt: string,
): StockLevel {
  return {
    id: newId(),
    variantId,
    warehouseId,
    onHand,
    reserved,
    updatedAt: new Date(updatedAt),
  };
}

/** Catalog with these variants, ordered by SKU as Catalog would give them; it remembers what it was asked. */
class FixedCatalog extends CatalogVariants {
  readonly asked: string[] = [];

  constructor(
    private readonly variants: readonly {
      id: VariantId;
      sku: string;
      productTitle: string;
    }[],
  ) {
    super();
  }

  exists(): Promise<boolean> {
    return Promise.reject(new Error('not used'));
  }

  labels(ids: readonly VariantId[]): Promise<Map<VariantId, VariantLabel>> {
    this.asked.push('labels');
    return Promise.resolve(
      new Map(
        [...this.variants]
          .sort((a, b) => (a.sku < b.sku ? -1 : 1))
          .filter(({ id }) => ids.includes(id))
          .map(({ id, sku, productTitle }) => [id, { sku, productTitle }]),
      ),
    );
  }

  search(text: string): Promise<VariantId[]> {
    this.asked.push(`search ${text}`);
    return Promise.resolve(
      this.variants
        .filter(
          ({ sku, productTitle }) =>
            sku.includes(text.toUpperCase()) ||
            productTitle.toLowerCase().includes(text.toLowerCase()),
        )
        .map(({ id }) => id),
    );
  }

  findBySku(sku: string): Promise<VariantId | null> {
    this.asked.push(`sku ${sku}`);
    return Promise.resolve(
      this.variants.find((variant) => variant.sku === sku.toUpperCase())?.id ??
        null,
    );
  }
}

/** Stock items in memory, filtered as the database would; it remembers how it was asked. */
class FixedStock extends InventoryQueries {
  readonly asked: { how: string; filter: StockFilter }[] = [];

  constructor(
    private readonly items: readonly StockLevel[],
    private readonly movementsOf: readonly StockMovement[] = [],
  ) {
    super();
  }

  listWarehouses(): Promise<WarehouseView[]> {
    return Promise.reject(new Error('not used'));
  }

  findWarehouse(): Promise<WarehouseView | null> {
    return Promise.reject(new Error('not used'));
  }

  pageOfStock(
    filter: StockFilter,
    sort: readonly SortOrder<'available' | 'updatedAt'>[],
    page: PageRequest,
  ): Promise<Page<StockLevel>> {
    this.asked.push({ how: `page by ${sort[0].field}`, filter });
    const found = this.filtered(filter);
    return Promise.resolve({
      items: found.slice(0, page.pageSize),
      totalItems: found.length,
    });
  }

  allStock(filter: StockFilter): Promise<StockLevel[]> {
    this.asked.push({ how: 'all', filter });
    return Promise.resolve(this.filtered(filter));
  }

  availableUnits(): Promise<ReadonlyMap<VariantId, number>> {
    return Promise.reject(new Error('not used'));
  }

  findStock(id: string): Promise<StockLevel | null> {
    return Promise.resolve(this.items.find((item) => item.id === id) ?? null);
  }

  listMovements(
    _id: string,
    _filter: unknown,
    position: MovementPosition | null,
    limit: number,
  ): Promise<StockMovement[]> {
    const start =
      position === null
        ? 0
        : this.movementsOf.findIndex(({ id }) => id === position.id) + 1;
    return Promise.resolve(this.movementsOf.slice(start, start + limit));
  }

  private filtered(filter: StockFilter): StockLevel[] {
    return this.items.filter(
      ({ variantId }) =>
        filter.variantIds === undefined ||
        filter.variantIds.includes(variantId),
    );
  }
}

describe('StockListing (UC-INV-04, ADR-0127)', () => {
  const [shirtM, shirtL, cap] = [
    newId<'Variant'>(),
    newId<'Variant'>(),
    newId<'Variant'>(),
  ];
  const catalog = () =>
    new FixedCatalog([
      { id: shirtM, sku: 'CAM-LINO-M', productTitle: 'Camisa de lino' },
      { id: shirtL, sku: 'CAM-LINO-L', productTitle: 'Camisa de lino' },
      { id: cap, sku: 'GORRA-AZUL', productTitle: 'Gorra' },
    ]);
  const items = [
    stock(cap, 4, 0, '2026-10-01T10:00:00Z'),
    stock(shirtM, 10, 3, '2026-10-01T09:00:00Z'),
    stock(shirtL, 2, 0, '2026-10-01T11:00:00Z'),
  ];
  const page = (number: number, pageSize = 2): PageRequest => ({
    page: number,
    pageSize,
  });

  it('sorts by SKU in Catalog order and pages in memory, with the SKU and title of each item', async () => {
    const queries = new FixedStock(items);
    const listing = new StockListing(queries, catalog());
    const bySku = [{ field: 'sku', direction: 'asc' }] as const;

    const first = await listing.list({}, bySku, page(1));
    const second = await listing.list({}, bySku, page(2));
    const descending = await listing.list(
      {},
      [{ field: 'sku', direction: 'desc' }],
      page(1, 10),
    );

    expect(first.items.map(({ sku }) => sku)).toEqual([
      'CAM-LINO-L',
      'CAM-LINO-M',
    ]);
    expect(first.items[1]).toMatchObject({
      productTitle: 'Camisa de lino',
      onHand: 10,
      reserved: 3,
      available: 7,
    });
    expect(second.items.map(({ sku }) => sku)).toEqual(['GORRA-AZUL']);
    expect(first.totalItems).toBe(3);
    expect(descending.items.map(({ sku }) => sku)).toEqual([
      'GORRA-AZUL',
      'CAM-LINO-M',
      'CAM-LINO-L',
    ]);
    expect(queries.asked.map(({ how }) => how)).toEqual(['all', 'all', 'all']);
  });

  it('sorts by SKU after another field, and by ID last', async () => {
    const twins = [
      stock(cap, 5, 0, '2026-10-01T10:00:00Z'),
      stock(shirtL, 5, 0, '2026-10-01T10:00:00Z'),
      stock(shirtM, 1, 0, '2026-10-01T10:00:00Z'),
    ];
    const listing = new StockListing(new FixedStock(twins), catalog());

    const sorted = await listing.list(
      {},
      [
        { field: 'available', direction: 'desc' },
        { field: 'sku', direction: 'asc' },
      ],
      page(1, 10),
    );

    expect(sorted.items.map(({ sku }) => sku)).toEqual([
      'CAM-LINO-L',
      'GORRA-AZUL',
      'CAM-LINO-M',
    ]);
  });

  it('keeps the stock of one variant in two warehouses in the order of their IDs', async () => {
    const [a, b] = [
      stock(cap, 1, 0, '2026-10-01T10:00:00Z'),
      stock(cap, 9, 0, '2026-10-01T10:00:00Z'),
    ];
    const [low, high] = a.id < b.id ? [a, b] : [b, a];
    const listing = new StockListing(new FixedStock([high, low]), catalog());

    const sorted = await listing.list(
      {},
      [{ field: 'sku', direction: 'desc' }],
      page(1, 10),
    );

    expect(sorted.items.map(({ id }) => id)).toEqual([low.id, high.id]);
  });

  it('leaves the other sorts to the database, and asks Catalog only for the page', async () => {
    const queries = new FixedStock(items);
    const variants = catalog();

    const found = await new StockListing(queries, variants).list(
      {},
      [{ field: 'available', direction: 'asc' }],
      page(1),
    );

    expect(queries.asked.map(({ how }) => how)).toEqual(['page by available']);
    expect(found.items.map(({ sku }) => sku)).toEqual([
      'GORRA-AZUL',
      'CAM-LINO-M',
    ]);
    expect(found.totalItems).toBe(3);
  });

  it('filters by the variants that match the SKU, the text and the variant, all at once', async () => {
    const queries = new FixedStock(items);
    const variants = catalog();
    const listing = new StockListing(queries, variants);
    const bySku = [{ field: 'sku', direction: 'asc' }] as const;

    const byText = await listing.list({ q: 'lino' }, bySku, page(1, 10));
    const bySkuAndText = await listing.list(
      { sku: 'cam-lino-m', q: 'camisa' },
      bySku,
      page(1, 10),
    );
    const byVariantAndText = await listing.list(
      { variantId: cap, q: 'lino' },
      bySku,
      page(1, 10),
    );

    expect(byText.items.map(({ sku }) => sku)).toEqual([
      'CAM-LINO-L',
      'CAM-LINO-M',
    ]);
    expect(byText.totalItems).toBe(2);
    expect(bySkuAndText.items.map(({ sku }) => sku)).toEqual(['CAM-LINO-M']);
    expect(byVariantAndText).toEqual({ items: [], totalItems: 0 });
    // Nothing can match, so the stock is not even read.
    expect(queries.asked).toHaveLength(2);
  });

  it('answers nothing for a SKU that does not exist', async () => {
    const queries = new FixedStock(items);

    const found = await new StockListing(queries, catalog()).list(
      { sku: 'NO-EXISTE' },
      [{ field: 'sku', direction: 'asc' }],
      page(1),
    );

    expect(found).toEqual({ items: [], totalItems: 0 });
    expect(queries.asked).toEqual([]);
  });

  describe('movements', () => {
    const [item] = items;
    const movement = (n: number): StockMovement => ({
      id: newId(),
      stockItemId: item.id,
      type: 'RECEIPT',
      quantity: n,
      onHandAfter: n,
      reasonCode: null,
      note: null,
      orderId: null,
      orderLineId: null,
      actorId: null,
      createdAt: new Date(Date.UTC(2026, 9, 1, 12, 0, 60 - n)),
    });
    const ledger = [1, 2, 3, 4, 5].map(movement);

    it('answers a page and where the next one starts, and no next one at the end', async () => {
      const listing = new StockListing(
        new FixedStock(items, ledger),
        catalog(),
      );

      const first = await listing.movements(item.id, {}, null, 2);
      const second = await listing.movements(item.id, {}, first.next, 2);
      const last = await listing.movements(item.id, {}, second.next, 2);
      const exact = await listing.movements(item.id, {}, null, 5);

      expect(first.movements).toEqual(ledger.slice(0, 2));
      expect(first.next).toEqual({
        createdAt: ledger[1].createdAt,
        id: ledger[1].id,
      });
      expect(second.movements).toEqual(ledger.slice(2, 4));
      expect(last).toEqual({ movements: ledger.slice(4), next: null });
      expect(exact.next).toBeNull();
    });

    it('answers a stock item that does not exist as not found', async () => {
      await expect(
        new StockListing(new FixedStock(items), catalog()).movements(
          newId(),
          {},
          null,
          10,
        ),
      ).rejects.toThrow(NotFoundError);
    });
  });
});
