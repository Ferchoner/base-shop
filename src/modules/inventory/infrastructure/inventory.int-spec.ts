import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import pg from 'pg';
import { waitForLockWaiters } from '../../../../test/support/lock-waiters.js';
import { AppCacheModule } from '../../../platform/cache/app-cache.module.js';
import { ClockModule } from '../../../platform/clock/clock.module.js';
import { validateEnvironment } from '../../../platform/config/environment.js';
import { EventsModule } from '../../../platform/events/events.module.js';
import { PersistenceModule } from '../../../platform/persistence/persistence.module.js';
import { PrismaService } from '../../../platform/persistence/prisma.service.js';
import { Clock, newId, NotFoundError } from '../../../shared-kernel/index.js';
import { AuditModule } from '../../audit/index.js';
import {
  InventoryQueries,
  type MovementPosition,
} from '../application/inventory.queries.js';
import { StockEntries } from '../application/stock-entries.use-case.js';
import { StockListing } from '../application/stock-listing.js';
import {
  UpdateWarehouse,
  type WarehouseAddressInput,
} from '../application/update-warehouse.use-case.js';
import {
  AdjustmentDirectionError,
  AdjustmentNoteRequiredError,
  type AdjustmentReason,
  InsufficientStockError,
  type StockItemId,
  type VariantId,
} from '../domain/stock.js';
import {
  InvalidWarehouseLocationError,
  type WarehouseId,
} from '../domain/warehouse.js';
import { InventoryModule } from '../inventory.module.js';

/** The warehouse the migration creates (ADR-0127). */
const MAIN = '01a0f54d-639d-7173-a3ff-f510cd91429d' as WarehouseId;
const MIGRATION = path.join(
  process.cwd(),
  'prisma',
  'migrations',
  '20260930200000_inventory_main_warehouse',
  'migration.sql',
);

const ADDRESS: WarehouseAddressInput = {
  recipientName: 'Ana Ruiz',
  phone: '4431234567',
  street: 'Av. Madero Poniente',
  exteriorNumber: '123',
  interiorNumber: null,
  neighborhood: 'Centro',
  postalCode: '58000',
  stateCode: '16',
  municipalityCode: '16053',
  city: 'Morelia',
  references: null,
};

/** Warehouse, stock and movements against PostgreSQL 18 (T-160 part a, ADR-0127). */
describe('Inventory: warehouse and stock (T-160 part a)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cls: ClsService;
  // A clock that moves forward a millisecond on each reading; tests set it to place movements in time.
  let current: number;
  const clock = {
    now: () => {
      current += 1;
      return new Date(current);
    },
  };
  const staffId = newId<'User'>();

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          validate: validateEnvironment,
        }),
        ClsModule.forRoot({ global: true }),
        PersistenceModule,
        ClockModule,
        EventsModule,
        AppCacheModule,
        AuditModule,
        InventoryModule,
      ],
    })
      .overrideProvider(Clock)
      .useValue(clock)
      .compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    cls = moduleRef.get(ClsService);
    for (const [code, name] of [
      ['16', 'Michoacán de Ocampo'],
      ['14', 'Jalisco'],
    ]) {
      await prisma.geoState.upsert({
        where: { code },
        create: { code, name },
        update: {},
      });
    }
    for (const [code, stateCode, name, isActive] of [
      ['16053', '16', 'Morelia', true],
      ['14039', '14', 'Guadalajara', true],
      ['16999', '16', 'Municipio retirado', false],
    ] as const) {
      await prisma.geoMunicipality.upsert({
        where: { code },
        create: { code, stateCode, name, isActive },
        update: {},
      });
    }
  });

  beforeEach(() => {
    current = Date.parse('2026-10-01T12:00:00.000Z');
  });

  afterEach(async () => {
    await prisma.stockMovement.deleteMany();
    await prisma.stockItem.deleteMany();
    await prisma.productVariant.deleteMany();
    await prisma.product.deleteMany();
    // Back to the warehouse of the migration.
    await prisma.$executeRaw`
      UPDATE warehouses SET name = 'Almacén principal', address = NULL WHERE id = ${MAIN}::uuid`;
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { action: { startsWith: 'inventory.' } },
          { action: 'warehouses.update' },
        ],
      },
    });
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  /** Variants of a new product with these SKUs, straight in the Catalog tables. */
  async function createVariants(
    title: string,
    ...skus: string[]
  ): Promise<VariantId[]> {
    const productId = newId();
    const ids = skus.map(() => newId<'Variant'>());
    await prisma.product.create({
      data: {
        id: productId,
        title,
        slug: `p-${productId}`,
        status: 'DRAFT',
      },
    });
    await prisma.productVariant.createMany({
      data: skus.map((sku, index) => ({
        id: ids[index],
        productId,
        sku,
        options: { n: String(index) },
        status: 'ACTIVE' as const,
      })),
    });
    return ids;
  }

  const entries = () => moduleRef.get(StockEntries);
  const receive = (variantId: VariantId, quantity: number, note?: string) =>
    cls.run(() =>
      entries().receive(
        { variantId, warehouseId: MAIN, quantity, note },
        staffId,
      ),
    );
  const adjust = (
    variantId: VariantId,
    quantity: number,
    reasonCode: AdjustmentReason = 'PHYSICAL_COUNT',
    note?: string,
  ) =>
    cls.run(() =>
      entries().adjust(
        { variantId, warehouseId: MAIN, quantity, reasonCode, note },
        staffId,
      ),
    );

  const stockOf = (variantId: VariantId) =>
    prisma.stockItem.findUniqueOrThrow({
      where: { variantId_warehouseId: { variantId, warehouseId: MAIN } },
    });

  /** The ledger adds up to `onHand` (BR-INV-13, DATABASE.md §12). */
  async function expectLedgerBalanced(variantId: VariantId): Promise<void> {
    const item = await stockOf(variantId);
    const { _sum } = await prisma.stockMovement.aggregate({
      where: { stockItemId: item.id },
      _sum: { quantity: true },
    });
    expect(_sum.quantity ?? 0).toBe(item.onHand);
  }

  const audited = (action: string) =>
    prisma.auditLog.findMany({
      where: { action },
      select: { resourceType: true, resourceId: true, changes: true },
    });

  describe('the warehouse', () => {
    it('is the only one, active, created by the migration, and never added twice (ADR-0081)', async () => {
      await prisma.$executeRawUnsafe(readFileSync(MIGRATION, 'utf8'));

      expect(await moduleRef.get(InventoryQueries).listWarehouses()).toEqual([
        expect.objectContaining({
          id: MAIN,
          code: 'PRINCIPAL',
          name: 'Almacén principal',
          address: null,
          status: 'ACTIVE',
        }),
      ]);
    });

    it('changes its name and address, keeps the names of the state and municipality, and audits the address without its values', async () => {
      const update = (changes: Parameters<UpdateWarehouse['execute']>[1]) =>
        cls.run(() => moduleRef.get(UpdateWarehouse).execute(MAIN, changes));

      await update({ name: ' Almacén Morelia ', address: ADDRESS });
      const changed = await moduleRef.get(InventoryQueries).findWarehouse(MAIN);
      await update({ name: 'Almacén Morelia' });
      await update({ address: null });
      const cleared = await moduleRef.get(InventoryQueries).findWarehouse(MAIN);

      expect(changed).toMatchObject({
        name: 'Almacén Morelia',
        address: {
          ...ADDRESS,
          stateName: 'Michoacán de Ocampo',
          municipalityName: 'Morelia',
          country: 'MX',
        },
      });
      expect(cleared?.address).toBeNull();
      expect(await audited('warehouses.update')).toEqual([
        {
          resourceType: 'warehouse',
          resourceId: MAIN,
          changes: {
            name: { from: 'Almacén principal', to: 'Almacén Morelia' },
            address: { changed: true },
          },
        },
        {
          resourceType: 'warehouse',
          resourceId: MAIN,
          changes: { address: { changed: true } },
        },
      ]);
    });

    it.each([
      ['a state that does not exist', { stateCode: '99' }],
      ['a municipality of another state', { municipalityCode: '14039' }],
      ['a retired municipality', { municipalityCode: '16999' }],
    ])('rejects %s, and changes nothing', async (_, wrong) => {
      await expect(
        cls.run(() =>
          moduleRef
            .get(UpdateWarehouse)
            .execute(MAIN, { name: 'Otro', address: { ...ADDRESS, ...wrong } }),
        ),
      ).rejects.toThrow(InvalidWarehouseLocationError);

      expect(
        await moduleRef.get(InventoryQueries).findWarehouse(MAIN),
      ).toMatchObject({ name: 'Almacén principal', address: null });
    });
  });

  describe('receipts and adjustments', () => {
    it('creates the stock item on the first receipt, adds the next ones, and records and audits each one', async () => {
      const [shirt] = await createVariants('Camisa de lino', 'CAM-LINO-M');

      const first = await receive(shirt, 25, ' Remisión 1234 ');
      const second = await receive(shirt, 5);

      expect(first.stockItem).toMatchObject({
        variantId: shirt,
        warehouseId: MAIN,
        sku: 'CAM-LINO-M',
        productTitle: 'Camisa de lino',
        onHand: 25,
        reserved: 0,
        available: 25,
      });
      expect(first.movement).toMatchObject({
        type: 'RECEIPT',
        quantity: 25,
        onHandAfter: 25,
        reasonCode: null,
        note: 'Remisión 1234',
        actorId: staffId,
      });
      expect(second.stockItem.id).toBe(first.stockItem.id);
      expect(second.stockItem.onHand).toBe(30);
      await expectLedgerBalanced(shirt);
      expect(await audited('inventory.receipt')).toContainEqual({
        resourceType: 'stock-item',
        resourceId: first.stockItem.id,
        changes: {
          variantId: { from: null, to: shirt },
          warehouseId: { from: null, to: MAIN },
          quantity: { from: null, to: 25 },
          note: { from: null, to: 'Remisión 1234' },
          onHandAfter: { from: null, to: 25 },
        },
      });
    });

    it('adjusts with a reason, never below what is reserved, and writes nothing when it cannot', async () => {
      const [shirt] = await createVariants('Camisa de lino', 'CAM-LINO-M');
      const { stockItem } = await receive(shirt, 10);
      await prisma.stockItem.update({
        where: { id: stockItem.id },
        data: { reserved: 4 },
      });

      const damaged = await adjust(shirt, -6, 'DAMAGED');
      await expect(adjust(shirt, -1, 'LOSS_OR_THEFT')).rejects.toThrow(
        InsufficientStockError,
      );
      const counted = await adjust(shirt, 3, 'PHYSICAL_COUNT');

      expect(damaged.movement).toMatchObject({
        type: 'ADJUSTMENT',
        quantity: -6,
        onHandAfter: 4,
        reasonCode: 'DAMAGED',
      });
      expect(counted.stockItem).toMatchObject({
        onHand: 7,
        reserved: 4,
        available: 3,
      });
      expect(
        await prisma.stockMovement.count({
          where: { stockItemId: stockItem.id },
        }),
      ).toBe(3);
      await expectLedgerBalanced(shirt);
      expect(await audited('inventory.adjustment')).toHaveLength(2);
    });

    it('creates no stock item for an adjustment that would leave it below zero', async () => {
      const [shirt] = await createVariants('Camisa de lino', 'CAM-LINO-M');

      await expect(adjust(shirt, -1)).rejects.toThrow(InsufficientStockError);

      expect(await prisma.stockItem.count()).toBe(0);
    });

    it('checks the reason before touching the stock', async () => {
      const [shirt] = await createVariants('Camisa de lino', 'CAM-LINO-M');

      await expect(adjust(shirt, 2, 'DAMAGED')).rejects.toThrow(
        AdjustmentDirectionError,
      );
      await expect(adjust(shirt, 2, 'OTHER', '  ')).rejects.toThrow(
        AdjustmentNoteRequiredError,
      );
      const other = await adjust(shirt, 2, 'OTHER', 'Regalo de proveedor');

      expect(other.movement).toMatchObject({
        reasonCode: 'OTHER',
        note: 'Regalo de proveedor',
      });
      expect(await prisma.stockMovement.count()).toBe(1);
    });

    it('answers a missing variant or a warehouse that is not the active one as not found', async () => {
      const [shirt] = await createVariants('Camisa de lino', 'CAM-LINO-M');
      const inactive = newId<'Warehouse'>();
      await prisma.warehouse.create({
        data: {
          id: inactive,
          code: 'VIEJO',
          name: 'Viejo',
          status: 'INACTIVE',
        },
      });

      try {
        await expect(receive(newId<'Variant'>(), 5)).rejects.toThrow(
          NotFoundError,
        );
        for (const warehouseId of [inactive, newId<'Warehouse'>()]) {
          await expect(
            cls.run(() =>
              entries().receive(
                { variantId: shirt, warehouseId, quantity: 5 },
                staffId,
              ),
            ),
          ).rejects.toThrow(NotFoundError);
        }
        expect(await prisma.stockItem.count()).toBe(0);
      } finally {
        await prisma.warehouse.delete({ where: { id: inactive } });
      }
    });
  });

  describe('changes at the same time', () => {
    async function holder(): Promise<pg.Client> {
      const client = new pg.Client({
        connectionString: process.env.DATABASE_URL,
      });
      await client.connect();
      await client.query('BEGIN');
      return client;
    }

    it('never takes more stock away than there is (BR-INV-01)', async () => {
      const [shirt] = await createVariants('Camisa de lino', 'CAM-LINO-M');
      const { stockItem } = await receive(shirt, 10);
      // Hold the stock item, which every adjustment updates, so all of them wait for it at once.
      const client = await holder();
      await client.query(
        'SELECT id FROM stock_items WHERE id = $1 FOR UPDATE',
        [stockItem.id],
      );

      const results = Promise.allSettled(
        Array.from({ length: 5 }, () => adjust(shirt, -3, 'DAMAGED')),
      );
      await waitForLockWaiters(5);
      await client.query('COMMIT');
      await client.end();
      const settled = await results;

      expect(
        settled.filter(({ status }) => status === 'fulfilled'),
      ).toHaveLength(3);
      for (const result of settled) {
        if (result.status === 'rejected') {
          expect(result.reason).toBeInstanceOf(InsufficientStockError);
        }
      }
      expect((await stockOf(shirt)).onHand).toBe(1);
      await expectLedgerBalanced(shirt);
    });

    it('creates the stock item once for two first receipts at the same time', async () => {
      const [shirt] = await createVariants('Camisa de lino', 'CAM-LINO-M');
      // Hold the warehouse, which both new stock items reference, so both inserts wait for it.
      const client = await holder();
      await client.query('SELECT id FROM warehouses WHERE id = $1 FOR UPDATE', [
        MAIN,
      ]);

      const results = Promise.all([receive(shirt, 5), receive(shirt, 7)]);
      await waitForLockWaiters(2);
      await client.query('COMMIT');
      await client.end();
      await results;

      expect(await prisma.stockItem.count()).toBe(1);
      expect((await stockOf(shirt)).onHand).toBe(12);
      await expectLedgerBalanced(shirt);
    });
  });

  describe('the listing', () => {
    async function stocked() {
      const [shirtM, shirtL] = await createVariants(
        'Camisa de lino',
        'CAM-LINO-M',
        'CAM-LINO-L',
      );
      const [cap] = await createVariants('Gorra', 'GORRA-AZUL');
      await receive(cap, 4);
      await receive(shirtM, 10);
      await receive(shirtL, 2);
      return { shirtM, shirtL, cap };
    }
    const list = (
      filter: Parameters<StockListing['list']>[0],
      sort: Parameters<StockListing['list']>[1] = [
        { field: 'sku', direction: 'asc' },
      ],
      page = { page: 1, pageSize: 20 },
    ) => moduleRef.get(StockListing).list(filter, sort, page);
    const skus = (found: Awaited<ReturnType<typeof list>>) =>
      found.items.map(({ sku }) => sku);

    it('sorts by SKU by default, with the SKU and title from Catalog, and pages with the right totals', async () => {
      await stocked();

      const first = await list({}, undefined, { page: 1, pageSize: 2 });
      const second = await list({}, undefined, { page: 2, pageSize: 2 });

      expect(skus(first)).toEqual(['CAM-LINO-L', 'CAM-LINO-M']);
      expect(first.items[0]).toMatchObject({
        productTitle: 'Camisa de lino',
        onHand: 2,
        available: 2,
      });
      expect(skus(second)).toEqual(['GORRA-AZUL']);
      expect(first.totalItems).toBe(3);
    });

    it('filters by text, SKU, variant, warehouse and available units, and sorts in the database by available units', async () => {
      const { shirtM, cap } = await stocked();

      expect(skus(await list({ q: 'LINO' }))).toEqual([
        'CAM-LINO-L',
        'CAM-LINO-M',
      ]);
      expect(skus(await list({ q: 'gorra' }))).toEqual(['GORRA-AZUL']);
      expect(skus(await list({ sku: 'cam-lino-m' }))).toEqual(['CAM-LINO-M']);
      expect(skus(await list({ variantId: cap, q: 'lino' }))).toEqual([]);
      expect(skus(await list({ warehouseId: newId<'Warehouse'>() }))).toEqual(
        [],
      );
      expect(
        skus(
          await list({ availableMax: 4 }, [
            { field: 'available', direction: 'desc' },
          ]),
        ),
      ).toEqual(['GORRA-AZUL', 'CAM-LINO-L']);
      const byAvailable = await list(
        {},
        [{ field: 'available', direction: 'asc' }],
        { page: 2, pageSize: 2 },
      );
      expect(skus(byAvailable)).toEqual(['CAM-LINO-M']);
      expect(byAvailable.totalItems).toBe(3);
      expect(byAvailable.items[0].variantId).toBe(shirtM);
    });
  });

  describe('movements', () => {
    it('pages newest first by cursor, and filters by type and dates', async () => {
      const [shirt] = await createVariants('Camisa de lino', 'CAM-LINO-M');
      current = Date.parse('2026-10-01T12:00:00.000Z');
      const { stockItem } = await receive(shirt, 10);
      current = Date.parse('2026-10-02T12:00:00.000Z');
      await adjust(shirt, -2, 'DAMAGED');
      current = Date.parse('2026-10-03T12:00:00.000Z');
      await receive(shirt, 5);
      const listing = moduleRef.get(StockListing);
      const id = stockItem.id as StockItemId;

      const first = await listing.movements(id, {}, null, 2);
      const second = await listing.movements(id, {}, first.next, 2);
      const receipts = await listing.movements(
        id,
        { types: ['RECEIPT'] },
        null,
        10,
      );
      const onTheSecond = await listing.movements(
        id,
        {
          from: new Date('2026-10-02T00:00:00.000Z'),
          to: new Date('2026-10-02T23:59:59.999Z'),
        },
        null,
        10,
      );

      expect(first.movements.map(({ quantity }) => quantity)).toEqual([5, -2]);
      expect(second.movements.map(({ quantity }) => quantity)).toEqual([10]);
      expect(second.next).toBeNull();
      expect(receipts.movements.map(({ quantity }) => quantity)).toEqual([
        5, 10,
      ]);
      expect(onTheSecond.movements.map(({ quantity }) => quantity)).toEqual([
        -2,
      ]);
      await expect(listing.movements(newId(), {}, null, 10)).rejects.toThrow(
        NotFoundError,
      );
    });

    it('pages through movements of the same instant by their IDs, each one once', async () => {
      const [shirt] = await createVariants('Camisa de lino', 'CAM-LINO-M');
      const { stockItem } = await receive(shirt, 1);
      const at = new Date('2026-10-05T12:00:00.000Z');
      await prisma.stockMovement.createMany({
        data: [2, 3, 4].map((quantity) => ({
          id: newId(),
          stockItemId: stockItem.id,
          type: 'RECEIPT' as const,
          quantity,
          onHandAfter: quantity,
          createdAt: at,
        })),
      });
      const listing = moduleRef.get(StockListing);
      const seen: number[] = [];

      let position: MovementPosition | null = null;
      do {
        const page: Awaited<ReturnType<StockListing['movements']>> =
          await listing.movements(stockItem.id as StockItemId, {}, position, 1);
        seen.push(...page.movements.map(({ quantity }) => quantity));
        position = page.next;
      } while (position !== null);

      expect(seen).toEqual([4, 3, 2, 1]);
    });
  });
});
