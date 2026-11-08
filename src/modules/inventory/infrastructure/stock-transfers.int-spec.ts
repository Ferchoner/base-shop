import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import { AppCacheModule } from '../../../platform/cache/app-cache.module.js';
import { ClockModule } from '../../../platform/clock/clock.module.js';
import { validateEnvironment } from '../../../platform/config/environment.js';
import { EventsModule } from '../../../platform/events/events.module.js';
import { IdempotencyModule } from '../../../platform/http/idempotency/idempotency.module.js';
import { PersistenceModule } from '../../../platform/persistence/persistence.module.js';
import { PrismaService } from '../../../platform/persistence/prisma.service.js';
import {
  Clock,
  InvalidStateTransitionError,
  newId,
  NotFoundError,
  VersionConflictError,
} from '../../../shared-kernel/index.js';
import { AuditModule } from '../../audit/index.js';
import { CreateWarehouse } from '../application/create-warehouse.use-case.js';
import { DeactivateWarehouse } from '../application/deactivate-warehouse.use-case.js';
import { InventoryFacade } from '../application/inventory.facade.js';
import { StockEntries } from '../application/stock-entries.use-case.js';
import {
  type StockTransferId,
  StockTransfers,
  type TransferReason,
} from '../application/stock-transfers.use-case.js';
import { InsufficientStockError, type VariantId } from '../domain/stock.js';
import { TransferCancelWindowError } from '../domain/stock-transfer.js';
import type { WarehouseId } from '../domain/warehouse.js';
import { InventoryModule } from '../inventory.module.js';

/** The warehouse the migration creates (ADR-0127), here the store 204. */
const MAIN = '01a0f54d-639d-7173-a3ff-f510cd91429d' as WarehouseId;

/** Transfers between warehouses against PostgreSQL 18 (T-163, ADR-0172). */
describe('Inventory: transfers between warehouses (T-163)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cls: ClsService;
  // A clock that moves forward a millisecond on each reading; tests set it to place a cancellation in time.
  let current: number;
  const clock = {
    now: () => {
      current += 1;
      return new Date(current);
    },
  };
  const staffId = newId<'User'>();
  const canceller = newId<'User'>();
  let other: WarehouseId;

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
        IdempotencyModule,
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
  });

  beforeEach(async () => {
    current = Date.parse('2026-11-08T18:00:00.000Z');
    other = await cls.run(() =>
      moduleRef.get(CreateWarehouse).execute({
        code: 'LOCAL-206',
        name: 'Local 206',
        address: null,
        priority: 2,
      }),
    );
  });

  afterEach(async () => {
    await prisma.reservationLine.deleteMany();
    await prisma.reservation.deleteMany();
    await prisma.stockMovement.deleteMany();
    await prisma.stockTransfer.deleteMany();
    await prisma.stockItem.deleteMany();
    await prisma.warehouse.deleteMany({ where: { id: { not: MAIN } } });
    await prisma.productVariant.deleteMany();
    await prisma.product.deleteMany();
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
      data: { id: productId, title, slug: `p-${productId}`, status: 'DRAFT' },
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

  const transfers = () => moduleRef.get(StockTransfers);
  const receiveIn = (
    warehouseId: WarehouseId,
    variantId: VariantId,
    quantity: number,
  ) =>
    cls.run(() =>
      moduleRef
        .get(StockEntries)
        .receive({ variantId, warehouseId, quantity }, staffId),
    );
  const transfer = (
    fromWarehouseId: WarehouseId,
    toWarehouseId: WarehouseId,
    lines: { variantId: VariantId; quantity: number }[],
    reason: TransferReason = 'SALE',
  ) =>
    cls.run(() =>
      transfers().record(
        { fromWarehouseId, toWarehouseId, reason, lines },
        staffId,
      ),
    );
  const cancel = (id: StockTransferId, version = 1) =>
    cls.run(() => transfers().cancel({ id, version, staffId: canceller }));

  const onHand = async (warehouseId: WarehouseId, variantId: VariantId) =>
    (
      await prisma.stockItem.findUnique({
        where: { variantId_warehouseId: { variantId, warehouseId } },
      })
    )?.onHand ?? null;

  /** The ledger adds up to `onHand` in each warehouse (BR-INV-13, DATABASE.md §12). */
  async function expectLedgerBalanced(variantId: VariantId): Promise<void> {
    const items = await prisma.stockItem.findMany({ where: { variantId } });
    for (const item of items) {
      const { _sum } = await prisma.stockMovement.aggregate({
        where: { stockItemId: item.id },
        _sum: { quantity: true },
      });
      expect(_sum.quantity ?? 0).toBe(item.onHand);
    }
  }

  it('moves the units in one step, with a consecutive folio, two TRANSFER movements per line and its audit', async () => {
    const [zelda, mario] = await createVariants('Juegos', 'ZELDA', 'MARIO');
    await receiveIn(MAIN, zelda, 5);
    await receiveIn(MAIN, mario, 2);
    await receiveIn(other, mario, 1);

    const first = await transfer(MAIN, other, [
      { variantId: zelda, quantity: 2 },
      { variantId: mario, quantity: 2 },
    ]);
    const second = await transfer(other, MAIN, [
      { variantId: mario, quantity: 1 },
    ]);

    expect(first).toEqual({
      id: first.id,
      folio: expect.stringMatching(/^T-\d{6,}$/),
      fromWarehouseId: MAIN,
      toWarehouseId: other,
      reason: 'SALE',
      note: null,
      status: 'COMPLETED',
      lines: expect.arrayContaining([
        { variantId: zelda, sku: 'ZELDA', productTitle: 'Juegos', quantity: 2 },
        { variantId: mario, sku: 'MARIO', productTitle: 'Juegos', quantity: 2 },
      ]),
      createdBy: staffId,
      createdAt: expect.any(Date),
      cancellableUntil: new Date(first.createdAt.getTime() + 10 * 60_000),
      cancelledBy: null,
      cancelledAt: null,
      version: 1,
    });
    expect(Number(second.folio.slice(2))).toBe(
      Number(first.folio.slice(2)) + 1,
    );
    expect([
      await onHand(MAIN, zelda),
      await onHand(other, zelda),
      await onHand(MAIN, mario),
      await onHand(other, mario),
    ]).toEqual([3, 2, 1, 2]);
    const movements = await prisma.stockMovement.findMany({
      where: { transferId: first.id },
      include: { stockItem: true },
    });
    expect(
      movements
        .map(({ type, quantity, stockItem }) => [
          type,
          stockItem.variantId === zelda ? 'ZELDA' : 'MARIO',
          stockItem.warehouseId === MAIN ? 'MAIN' : 'OTHER',
          quantity,
        ])
        .sort(),
    ).toEqual(
      [
        ['TRANSFER', 'MARIO', 'MAIN', -2],
        ['TRANSFER', 'MARIO', 'OTHER', 2],
        ['TRANSFER', 'ZELDA', 'MAIN', -2],
        ['TRANSFER', 'ZELDA', 'OTHER', 2],
      ].sort(),
    );
    await expectLedgerBalanced(zelda);
    await expectLedgerBalanced(mario);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'inventory.transfer', resourceId: first.id },
    });
    expect(audit).toMatchObject({
      resourceType: 'stock-transfer',
      changes: expect.objectContaining({
        folio: { from: null, to: first.folio },
      }),
    });
  });

  it('moves only the available units, and moves nothing when one line is short', async () => {
    const [zelda, mario] = await createVariants('Juegos', 'ZELDA', 'MARIO');
    await receiveIn(MAIN, zelda, 5);
    await receiveIn(MAIN, mario, 1);
    await cls.run(() =>
      moduleRef
        .get(InventoryFacade)
        .reserve(newId<'Order'>(), [{ variantId: zelda, quantity: 3 }]),
    );

    await expect(
      transfer(MAIN, other, [
        { variantId: zelda, quantity: 3 },
        { variantId: mario, quantity: 2 },
      ]),
    ).rejects.toMatchObject({
      code: 'insufficient-stock',
      details: {
        lines: expect.arrayContaining([
          { variantId: zelda, canFulfill: false },
          { variantId: mario, canFulfill: false },
        ]),
      },
    });

    expect(await prisma.stockTransfer.count()).toBe(0);
    expect(
      await prisma.stockMovement.count({ where: { type: 'TRANSFER' } }),
    ).toBe(0);
    expect([await onHand(MAIN, zelda), await onHand(other, zelda)]).toEqual([
      5,
      null,
    ]);
    await expect(
      transfer(MAIN, other, [{ variantId: zelda, quantity: 2 }]),
    ).resolves.toMatchObject({ status: 'COMPLETED' });
  });

  it('takes from an inactive warehouse to empty it, never to one, nor with a variant or warehouse that does not exist', async () => {
    const [zelda] = await createVariants('Juegos', 'ZELDA');
    await receiveIn(other, zelda, 2);
    await cls.run(() => moduleRef.get(DeactivateWarehouse).execute(other));

    await expect(
      transfer(MAIN, other, [{ variantId: zelda, quantity: 1 }]),
    ).rejects.toThrow(NotFoundError);
    await expect(
      transfer(MAIN, newId<'Warehouse'>(), [{ variantId: zelda, quantity: 1 }]),
    ).rejects.toThrow(NotFoundError);
    await expect(
      transfer(newId<'Warehouse'>(), MAIN, [{ variantId: zelda, quantity: 1 }]),
    ).rejects.toThrow(NotFoundError);
    await expect(
      transfer(other, MAIN, [{ variantId: newId<'Variant'>(), quantity: 1 }]),
    ).rejects.toThrow(NotFoundError);
    await transfer(other, MAIN, [{ variantId: zelda, quantity: 2 }]);

    expect([await onHand(other, zelda), await onHand(MAIN, zelda)]).toEqual([
      0, 2,
    ]);
  });

  describe('cancel (ADR-0172)', () => {
    it('brings the units back in its first 10 minutes, with opposite movements, once', async () => {
      const [zelda] = await createVariants('Juegos', 'ZELDA');
      await receiveIn(MAIN, zelda, 5);
      const done = await transfer(MAIN, other, [
        { variantId: zelda, quantity: 2 },
      ]);
      current = done.createdAt.getTime() + 10 * 60_000 - 1;

      const cancelled = await cancel(done.id);

      expect(cancelled).toMatchObject({
        status: 'CANCELLED',
        cancellableUntil: null,
        cancelledBy: canceller,
        cancelledAt: new Date(done.createdAt.getTime() + 10 * 60_000),
        version: 2,
      });
      expect([await onHand(MAIN, zelda), await onHand(other, zelda)]).toEqual([
        5, 0,
      ]);
      expect(
        await prisma.stockMovement.count({ where: { transferId: done.id } }),
      ).toBe(4);
      await expectLedgerBalanced(zelda);
      await expect(cancel(done.id, 2)).rejects.toThrow(
        InvalidStateTransitionError,
      );
      expect(
        await prisma.auditLog.count({
          where: { action: 'inventory.transfer-cancel', resourceId: done.id },
        }),
      ).toBe(1);
    });

    it('is not cancelled after 10 minutes, with another version, nor when the destination no longer has the units', async () => {
      const [zelda, mario] = await createVariants('Juegos', 'ZELDA', 'MARIO');
      await receiveIn(MAIN, zelda, 5);
      await receiveIn(MAIN, mario, 5);
      const late = await transfer(MAIN, other, [
        { variantId: zelda, quantity: 1 },
      ]);
      const sold = await transfer(MAIN, other, [
        { variantId: mario, quantity: 2 },
      ]);
      // One of the two units broke at the destination.
      await cls.run(() =>
        moduleRef.get(StockEntries).adjust(
          {
            variantId: mario,
            warehouseId: other,
            quantity: -1,
            reasonCode: 'DAMAGED',
          },
          staffId,
        ),
      );

      await expect(cancel(sold.id, 7)).rejects.toThrow(VersionConflictError);
      await expect(cancel(sold.id)).rejects.toThrow(InsufficientStockError);
      current = late.createdAt.getTime() + 10 * 60_000 + 1;
      await expect(cancel(late.id)).rejects.toThrow(TransferCancelWindowError);
      await expect(cancel(newId<'StockTransfer'>())).rejects.toThrow(
        NotFoundError,
      );

      expect(
        await prisma.stockTransfer.findMany({
          select: { status: true, version: true },
        }),
      ).toEqual([
        { status: 'COMPLETED', version: 1 },
        { status: 'COMPLETED', version: 1 },
      ]);
      expect([await onHand(MAIN, zelda), await onHand(other, zelda)]).toEqual([
        4, 1,
      ]);
    });
  });

  describe('at the same time', () => {
    it('lets only one of two transfers take the last units', async () => {
      const [zelda] = await createVariants('Juegos', 'ZELDA');
      await receiveIn(MAIN, zelda, 1);

      const results = await Promise.allSettled([
        transfer(MAIN, other, [{ variantId: zelda, quantity: 1 }]),
        transfer(MAIN, other, [{ variantId: zelda, quantity: 1 }]),
      ]);

      expect(results.map(({ status }) => status).sort()).toEqual([
        'fulfilled',
        'rejected',
      ]);
      expect(
        results.find(
          (result): result is PromiseRejectedResult =>
            result.status === 'rejected',
        )?.reason,
      ).toBeInstanceOf(InsufficientStockError);
      expect([await onHand(MAIN, zelda), await onHand(other, zelda)]).toEqual([
        0, 1,
      ]);
      await expectLedgerBalanced(zelda);
    });

    it('moves both ways without a deadlock, because the stock items change in ID order', async () => {
      const [zelda, mario] = await createVariants('Juegos', 'ZELDA', 'MARIO');
      for (const warehouseId of [MAIN, other]) {
        await receiveIn(warehouseId, zelda, 10);
        await receiveIn(warehouseId, mario, 10);
      }

      await Promise.all(
        Array.from({ length: 6 }, (_, index) =>
          index % 2 === 0
            ? transfer(MAIN, other, [
                { variantId: zelda, quantity: 1 },
                { variantId: mario, quantity: 1 },
              ])
            : transfer(other, MAIN, [
                { variantId: mario, quantity: 1 },
                { variantId: zelda, quantity: 1 },
              ]),
        ),
      );

      expect([
        await onHand(MAIN, zelda),
        await onHand(other, zelda),
        await onHand(MAIN, mario),
        await onHand(other, mario),
      ]).toEqual([10, 10, 10, 10]);
      expect(await prisma.stockTransfer.count()).toBe(6);
    });
  });

  it('lists the newest first, by warehouse on either side, variant, reason, status and dates', async () => {
    const [zelda, mario] = await createVariants('Juegos', 'ZELDA', 'MARIO');
    await receiveIn(MAIN, zelda, 5);
    await receiveIn(MAIN, mario, 5);
    const third = await cls.run(() =>
      moduleRef.get(CreateWarehouse).execute({
        code: 'BODEGA',
        name: 'Bodega',
        address: null,
        priority: 3,
      }),
    );
    const toOther = await transfer(MAIN, other, [
      { variantId: zelda, quantity: 1 },
    ]);
    const toThird = await transfer(
      MAIN,
      third,
      [{ variantId: mario, quantity: 1 }],
      'RESTOCK',
    );
    await cancel(toThird.id);
    const list = (filter: Parameters<StockTransfers['list']>[0]) =>
      cls
        .run(() => transfers().list(filter, { page: 1, pageSize: 20 }))
        .then(({ items, totalItems }) => ({
          folios: items.map(({ folio }) => folio),
          totalItems,
        }));

    expect(await list({})).toEqual({
      folios: [toThird.folio, toOther.folio],
      totalItems: 2,
    });
    expect((await list({ warehouseId: other })).folios).toEqual([
      toOther.folio,
    ]);
    expect((await list({ warehouseId: MAIN })).totalItems).toBe(2);
    expect((await list({ variantId: mario })).folios).toEqual([toThird.folio]);
    expect((await list({ reason: 'SALE' })).folios).toEqual([toOther.folio]);
    expect((await list({ status: 'CANCELLED' })).folios).toEqual([
      toThird.folio,
    ]);
    expect(
      (await list({ from: new Date(toThird.createdAt.getTime() + 1) }))
        .totalItems,
    ).toBe(0);
    expect((await list({ to: toOther.createdAt })).folios).toEqual([
      toOther.folio,
    ]);
  });
});
