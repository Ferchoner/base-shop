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
import {
  Clock,
  DuplicateValueError,
  InvalidStateTransitionError,
  newId,
  NotFoundError,
  ResourceInUseError,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import { AuditModule } from '../../audit/index.js';
import { CreateWarehouse } from '../application/create-warehouse.use-case.js';
import { DeactivateWarehouse } from '../application/deactivate-warehouse.use-case.js';
import { InventoryFacade } from '../application/inventory.facade.js';
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
import { StockLedgerRepository } from '../domain/stock-ledger.repository.js';
import {
  InvalidWarehouseLocationError,
  LastActiveWarehouseError,
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
    await prisma.reservationLine.deleteMany();
    await prisma.reservation.deleteMany();
    await prisma.stockMovement.deleteMany();
    await prisma.stockItem.deleteMany();
    await prisma.warehouse.deleteMany({ where: { id: { not: MAIN } } });
    await prisma.productVariant.deleteMany();
    await prisma.product.deleteMany();
    // Back to the warehouse of the migration.
    await prisma.$executeRaw`
      UPDATE warehouses SET name = 'Almacén principal', address = NULL, status = 'ACTIVE', priority = 1
       WHERE id = ${MAIN}::uuid`;
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { action: { startsWith: 'inventory.' } },
          { action: { startsWith: 'warehouses.' } },
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
    it('is created active by the migration, first by priority, and never added twice (ADR-0127)', async () => {
      await prisma.$executeRawUnsafe(readFileSync(MIGRATION, 'utf8'));

      expect(await moduleRef.get(InventoryQueries).listWarehouses()).toEqual([
        expect.objectContaining({
          id: MAIN,
          code: 'PRINCIPAL',
          name: 'Almacén principal',
          address: null,
          status: 'ACTIVE',
          priority: 1,
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

    it('answers a missing variant or a warehouse that is not active as not found', async () => {
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
        // An adjustment takes an inactive warehouse, but not one that does not exist (ADR-0160).
        const unknown = newId<'Warehouse'>();
        await expect(
          cls.run(() =>
            entries().adjust(
              {
                variantId: shirt,
                warehouseId: unknown,
                quantity: 5,
                reasonCode: 'PHYSICAL_COUNT',
              },
              staffId,
            ),
          ),
        ).rejects.toThrow(new NotFoundError('Warehouse', unknown));
        expect(await prisma.stockItem.count()).toBe(0);
      } finally {
        await prisma.warehouse.delete({ where: { id: inactive } });
      }
    });
  });

  describe('several warehouses (T-162 part b, ADR-0160)', () => {
    const create = (code: string, priority: number) =>
      cls.run(() =>
        moduleRef
          .get(CreateWarehouse)
          .execute({ code, name: `Almacén ${code}`, address: null, priority }),
      );
    const deactivate = (id: WarehouseId) =>
      cls.run(() => moduleRef.get(DeactivateWarehouse).execute(id));
    const receiveIn = (
      warehouseId: WarehouseId,
      variantId: VariantId,
      quantity: number,
    ) =>
      cls.run(() =>
        entries().receive({ variantId, warehouseId, quantity }, staffId),
      );
    const transfer = (
      warehouseId: WarehouseId,
      variantId: VariantId,
      quantity: number,
    ) =>
      cls.run(() =>
        entries().adjust(
          {
            variantId,
            warehouseId,
            quantity,
            reasonCode: 'WAREHOUSE_TRANSFER',
          },
          staffId,
        ),
      );
    const reserve = (variantId: VariantId, quantity: number) => {
      const orderId = newId<'Order'>();
      return cls
        .run(() =>
          moduleRef
            .get(InventoryFacade)
            .reserve(orderId, [{ variantId, quantity }]),
        )
        .then(() => orderId);
    };
    const statusOf = async (id: WarehouseId) =>
      (await prisma.warehouse.findUniqueOrThrow({ where: { id } })).status;

    /** A promise to resolve by hand, to keep a transaction open while another one starts. */
    function gate() {
      let open = () => {};
      const opened = new Promise<void>((resolve) => {
        open = resolve;
      });
      return { opened, open };
    }

    it('creates an active warehouse with its priority, audited, and never two with the same code (UC-INV-10)', async () => {
      const north = await create('NORTE', 2);

      expect(
        (await moduleRef.get(InventoryQueries).listWarehouses()).map(
          ({ code, status, priority }) => [code, status, priority],
        ),
      ).toEqual([
        ['PRINCIPAL', 'ACTIVE', 1],
        ['NORTE', 'ACTIVE', 2],
      ]);
      expect(await audited('warehouses.create')).toEqual([
        {
          resourceType: 'warehouse',
          resourceId: north,
          changes: {
            code: { from: null, to: 'NORTE' },
            name: { from: null, to: 'Almacén NORTE' },
            priority: { from: null, to: 2 },
            status: { from: null, to: 'ACTIVE' },
          },
        },
      ]);
      await expect(create('NORTE', 3)).rejects.toThrow(
        new DuplicateValueError('code'),
      );
    });

    it('changes the priority of a warehouse, audited (ADR-0160)', async () => {
      await cls.run(() =>
        moduleRef.get(UpdateWarehouse).execute(MAIN, { priority: 5 }),
      );

      expect(
        (await prisma.warehouse.findUniqueOrThrow({ where: { id: MAIN } }))
          .priority,
      ).toBe(5);
      expect(await audited('warehouses.update')).toEqual([
        expect.objectContaining({
          changes: { priority: { from: 1, to: 5 } },
        }),
      ]);
    });

    it('deactivates a warehouse for good: it takes no more stock, and adjustments move what it kept (UC-INV-11)', async () => {
      const [shirt] = await createVariants('Camisa de lino', 'CAM-LINO-M');
      const north = await create('NORTE', 2);
      await receiveIn(north, shirt, 3);

      await deactivate(north);
      const out = await transfer(north, shirt, -3);
      const into = await transfer(MAIN, shirt, 3);

      expect(await statusOf(north)).toBe('INACTIVE');
      expect(await audited('warehouses.deactivate')).toEqual([
        {
          resourceType: 'warehouse',
          resourceId: north,
          changes: { status: { from: 'ACTIVE', to: 'INACTIVE' } },
        },
      ]);
      await expect(receiveIn(north, shirt, 1)).rejects.toThrow(
        new NotFoundError('Warehouse', north),
      );
      expect([
        out.movement.reasonCode,
        out.stockItem.onHand,
        into.stockItem.onHand,
      ]).toEqual(['WAREHOUSE_TRANSFER', 0, 3]);
      await expect(deactivate(north)).rejects.toThrow(
        InvalidStateTransitionError,
      );
      await expect(deactivate(newId<'Warehouse'>())).rejects.toThrow(
        NotFoundError,
      );
    });

    it('never deactivates a warehouse that holds units for orders, nor the last active one', async () => {
      const [shirt] = await createVariants('Camisa de lino', 'CAM-LINO-M');
      const north = await create('NORTE', 2);
      await receiveIn(north, shirt, 2);
      const orderId = await reserve(shirt, 1);

      await expect(deactivate(north)).rejects.toThrow(ResourceInUseError);
      await deactivate(MAIN);
      await cls.run(() => moduleRef.get(InventoryFacade).release(orderId));
      await expect(deactivate(north)).rejects.toThrow(LastActiveWarehouseError);

      expect([await statusOf(MAIN), await statusOf(north)]).toEqual([
        'INACTIVE',
        'ACTIVE',
      ]);
    });

    it('waits for a reservation under way in the warehouse, and then refuses to deactivate it', async () => {
      const [shirt] = await createVariants('Camisa de lino', 'CAM-LINO-M');
      const north = await create('NORTE', 2);
      await receiveIn(north, shirt, 2);
      const { opened, open } = gate();
      // The reservation holds the warehouse until its transaction ends.
      const reserving = cls.run(() =>
        moduleRef.get(TransactionManager).run(async () => {
          await moduleRef
            .get(InventoryFacade)
            .reserve(newId<'Order'>(), [{ variantId: shirt, quantity: 1 }]);
          await opened;
        }),
      );
      await waitForReserved(north, shirt);

      const deactivating = deactivate(north);
      await waitForLockWaiters(1);
      open();
      await reserving;

      await expect(deactivating).rejects.toThrow(ResourceInUseError);
      expect(await statusOf(north)).toBe('ACTIVE');
    });

    it('makes a reservation under way wait for a deactivation, and then reserve in the next warehouse', async () => {
      const [shirt] = await createVariants('Camisa de lino', 'CAM-LINO-M');
      await receive(shirt, 1);
      const north = await create('NORTE', 1);
      await receiveIn(north, shirt, 5);
      const { opened, open } = gate();
      // The north warehouse comes first by code; its deactivation holds it until it commits.
      const deactivating = cls.run(() =>
        moduleRef.get(TransactionManager).run(async () => {
          await moduleRef.get(DeactivateWarehouse).execute(north);
          await opened;
        }),
      );
      await waitForStatus(north);

      const orderId = newId<'Order'>();
      const reserving = cls.run(() =>
        moduleRef
          .get(InventoryFacade)
          .reserve(orderId, [{ variantId: shirt, quantity: 1 }]),
      );
      await waitForLockWaiters(1);
      open();
      await deactivating;
      await reserving;
      await cls.run(() => moduleRef.get(InventoryFacade).commit(orderId));

      expect(
        await cls.run(() =>
          moduleRef.get(InventoryFacade).allocationOf(orderId),
        ),
      ).toEqual([
        { warehouseId: MAIN, lines: [{ variantId: shirt, quantity: 1 }] },
      ]);
      expect(await statusOf(north)).toBe('INACTIVE');
    });

    it('makes a receipt under way wait for a deactivation, and then answers the warehouse as not found', async () => {
      const [shirt] = await createVariants('Camisa de lino', 'CAM-LINO-M');
      const north = await create('NORTE', 2);
      const { opened, open } = gate();
      const deactivating = cls.run(() =>
        moduleRef.get(TransactionManager).run(async () => {
          await moduleRef.get(DeactivateWarehouse).execute(north);
          await opened;
        }),
      );
      await waitForStatus(north);

      const receiving = receiveIn(north, shirt, 3);
      await waitForLockWaiters(1);
      open();
      await deactivating;

      await expect(receiving).rejects.toThrow(
        new NotFoundError('Warehouse', north),
      );
      expect(
        await prisma.stockItem.count({ where: { warehouseId: north } }),
      ).toBe(0);
    });

    it('finds where the stock of an order left from, by priority, without what came back there nor other orders', async () => {
      const [shirt, cap] = await createVariants(
        'Camisa de lino',
        'CAM-LINO-M',
        'GORRA-AZUL',
      );
      // The north warehouse comes first by priority, though its code comes before the main one's.
      const north = await create('NORTE', 2);
      await prisma.warehouse.update({
        where: { id: MAIN },
        data: { priority: 3 },
      });
      const item = async (warehouseId: WarehouseId, variantId: VariantId) => {
        const id = newId<'StockItem'>();
        await prisma.stockItem.create({
          data: { id, variantId, warehouseId, onHand: 10 },
        });
        return id;
      };
      const [mainShirt, northShirt, northCap] = [
        await item(MAIN, shirt),
        await item(north, shirt),
        await item(north, cap),
      ];
      const [orderId, other] = [newId<'Order'>(), newId<'Order'>()];
      const line = newId<'OrderLine'>();
      const movement = (
        stockItemId: string,
        type: 'SALE' | 'RESTOCK',
        quantity: number,
        order: string,
      ) =>
        prisma.stockMovement.create({
          data: {
            id: newId(),
            stockItemId,
            type,
            quantity,
            onHandAfter: 10,
            orderId: order,
            ...(type === 'RESTOCK'
              ? { reasonCode: 'ORDER_CANCELLED', orderLineId: line }
              : {}),
          },
        });
      // As a split order would leave: shirts from both warehouses; one came back to the main one, and a cap
      // went to the north one, which it never left.
      await movement(northShirt, 'SALE', -1, orderId);
      await movement(mainShirt, 'SALE', -2, orderId);
      await movement(mainShirt, 'RESTOCK', 1, orderId);
      await movement(northCap, 'RESTOCK', 1, orderId);
      await movement(northShirt, 'SALE', -5, other);

      expect(
        await moduleRef.get(StockLedgerRepository).originsOf(orderId),
      ).toEqual([
        { warehouseId: north, variantId: shirt, units: 1 },
        { warehouseId: MAIN, variantId: shirt, units: 1 },
      ]);
    });

    it('lets one of two deactivations at the same time through when they would leave no warehouse active', async () => {
      const north = await create('NORTE', 2);
      const client = await lockingClient();
      // Hold the main warehouse, which both lock, so both deactivations are under way at once.
      await client.query('SELECT id FROM warehouses WHERE id = $1 FOR UPDATE', [
        MAIN,
      ]);

      const results = Promise.allSettled([deactivate(MAIN), deactivate(north)]);
      await waitForLockWaiters(2);
      await client.query('COMMIT');
      await client.end();
      const settled = await results;

      expect(
        settled.filter(({ status }) => status === 'fulfilled'),
      ).toHaveLength(1);
      expect(
        settled.find(
          (result): result is PromiseRejectedResult =>
            result.status === 'rejected',
        )?.reason,
      ).toBeInstanceOf(LastActiveWarehouseError);
      expect(
        await prisma.warehouse.count({ where: { status: 'ACTIVE' } }),
      ).toBe(1);
    });

    async function lockingClient(): Promise<pg.Client> {
      const client = new pg.Client({
        connectionString: process.env.DATABASE_URL,
      });
      await client.connect();
      await client.query('BEGIN');
      return client;
    }

    /** Waits until another transaction holds units of the variant in the warehouse, uncommitted. */
    async function waitForReserved(
      warehouseId: WarehouseId,
      variantId: VariantId,
    ): Promise<void> {
      const client = await lockingClient();
      try {
        // NOWAIT fails while the reservation holds the stock item: then it is under way.
        for (let tries = 0; tries < 100; tries += 1) {
          await client.query('SAVEPOINT probe');
          try {
            await client.query(
              'SELECT id FROM stock_items WHERE warehouse_id = $1 AND variant_id = $2 FOR UPDATE NOWAIT',
              [warehouseId, variantId],
            );
            await client.query('ROLLBACK TO SAVEPOINT probe');
          } catch {
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        throw new Error('The reservation never started');
      } finally {
        await client.query('ROLLBACK');
        await client.end();
      }
    }

    /** Waits until another transaction holds the warehouse row, as a deactivation under way does. */
    async function waitForStatus(warehouseId: WarehouseId): Promise<void> {
      const client = await lockingClient();
      try {
        for (let tries = 0; tries < 100; tries += 1) {
          await client.query('SAVEPOINT probe');
          try {
            await client.query(
              'SELECT id FROM warehouses WHERE id = $1 FOR SHARE NOWAIT',
              [warehouseId],
            );
            await client.query('ROLLBACK TO SAVEPOINT probe');
          } catch {
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        throw new Error('The deactivation never started');
      } finally {
        await client.query('ROLLBACK');
        await client.end();
      }
    }
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
