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
  newId,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import { AuditModule } from '../../audit/index.js';
import { InventoryFacade } from '../application/inventory.facade.js';
import { StockEntries } from '../application/stock-entries.use-case.js';
import type { OrderId, StockRequest } from '../domain/reservation.js';
import { InsufficientStockError, type VariantId } from '../domain/stock.js';
import type { WarehouseId } from '../domain/warehouse.js';
import { InventoryModule } from '../inventory.module.js';

/** The warehouse the migration creates (ADR-0127). */
const MAIN = '01a0f54d-639d-7173-a3ff-f510cd91429d' as WarehouseId;
const MINUTE = 60_000;

/** Reservations and availability against PostgreSQL 18 (T-160 part b, UC-INV-05 to 07, ADR-0128). */
describe('Inventory: reservations (T-160 part b)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cls: ClsService;
  let inventory: InventoryFacade;
  // A clock that moves forward a millisecond on each reading; tests move it further to pass the TTL.
  let current: number;
  const clock = {
    now: () => {
      current += 1;
      return new Date(current);
    },
  };

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
    inventory = moduleRef.get(InventoryFacade);
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
    await prisma.auditLog.deleteMany({
      where: { action: { startsWith: 'inventory.' } },
    });
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  /** Variants of a new product, each received with its units (0: no stock item). */
  async function stocked(...units: number[]): Promise<VariantId[]> {
    const productId = newId();
    const ids = units.map(() => newId<'Variant'>());
    await prisma.product.create({
      data: {
        id: productId,
        title: `Camisa ${productId}`,
        slug: `p-${productId}`,
        status: 'DRAFT',
      },
    });
    await prisma.productVariant.createMany({
      data: ids.map((id, index) => ({
        id,
        productId,
        sku: `SKU-${id}`.toUpperCase(),
        options: { n: String(index) },
        status: 'ACTIVE' as const,
      })),
    });
    for (const [index, quantity] of units.entries()) {
      if (quantity === 0) continue;
      await cls.run(() =>
        moduleRef
          .get(StockEntries)
          .receive(
            { variantId: ids[index], warehouseId: MAIN, quantity },
            newId(),
          ),
      );
    }
    return ids;
  }

  const reserve = (orderId: OrderId, requests: StockRequest[]) =>
    cls.run(() => inventory.reserve(orderId, requests));
  const commit = (orderId: OrderId) => cls.run(() => inventory.commit(orderId));
  const release = (orderId: OrderId) =>
    cls.run(() => inventory.release(orderId));
  const expire = (orderId: OrderId) => cls.run(() => inventory.expire(orderId));

  const stockOf = (variantId: VariantId) =>
    prisma.stockItem.findUniqueOrThrow({
      where: { variantId_warehouseId: { variantId, warehouseId: MAIN } },
      select: { id: true, onHand: true, reserved: true },
    });

  /** The ledger adds up to `onHand` (BR-INV-13). */
  async function expectLedgerBalanced(variantId: VariantId): Promise<void> {
    const item = await stockOf(variantId);
    const { _sum } = await prisma.stockMovement.aggregate({
      where: { stockItemId: item.id },
      _sum: { quantity: true },
    });
    expect(_sum.quantity).toBe(item.onHand);
  }

  async function holder(): Promise<pg.Client> {
    const client = new pg.Client({
      connectionString: process.env.DATABASE_URL,
    });
    await client.connect();
    await client.query('BEGIN');
    return client;
  }

  describe('reserving', () => {
    it('reserves every line, added up, until the TTL passes (UC-INV-05, BR-INV-07)', async () => {
      const [shirt, cap] = await stocked(10, 4);
      const orderId = newId<'Order'>();

      const receipt = await reserve(orderId, [
        { variantId: shirt, quantity: 2 },
        { variantId: cap, quantity: 4 },
        { variantId: shirt, quantity: 1 },
      ]);

      expect(await stockOf(shirt)).toMatchObject({ onHand: 10, reserved: 3 });
      expect(await stockOf(cap)).toMatchObject({ onHand: 4, reserved: 4 });
      const stored = await prisma.reservation.findUniqueOrThrow({
        where: { id: receipt.reservationId },
        include: { lines: true },
      });
      expect(stored).toMatchObject({
        orderId,
        status: 'ACTIVE',
        expiresAt: receipt.expiresAt,
        version: 1,
      });
      expect(receipt.expiresAt.getTime() - stored.createdAt.getTime()).toBe(
        20 * MINUTE,
      );
      expect(stored.lines).toHaveLength(2);
    });

    it('answers the active reservation of the order again, without reserving twice (BR-INV-04)', async () => {
      const [shirt] = await stocked(10);
      const orderId = newId<'Order'>();
      const first = await reserve(orderId, [{ variantId: shirt, quantity: 2 }]);

      const again = await reserve(orderId, [{ variantId: shirt, quantity: 2 }]);

      expect(again).toEqual(first);
      expect((await stockOf(shirt)).reserved).toBe(2);
      expect(await prisma.reservation.count()).toBe(1);
    });

    it('reserves nothing when any line falls short, and names every short variant (BR-INV-02)', async () => {
      const [shirt, cap, unstocked] = await stocked(10, 1, 0);

      await expect(
        reserve(newId<'Order'>(), [
          { variantId: shirt, quantity: 5 },
          { variantId: cap, quantity: 2 },
          { variantId: unstocked, quantity: 1 },
        ]),
      ).rejects.toThrow(new InsufficientStockError([cap, unstocked]));

      expect((await stockOf(shirt)).reserved).toBe(0);
      expect((await stockOf(cap)).reserved).toBe(0);
      expect(await prisma.reservation.count()).toBe(0);
    });

    it('reserves nothing when a line falls short inside a larger transaction, which goes on (ADR-0133)', async () => {
      const [shirt, cap] = await stocked(10, 1);
      const [later] = await stocked(3);
      const orderId = newId<'Order'>();
      const transactions = moduleRef.get(TransactionManager);

      await cls.run(() =>
        transactions.run(async () => {
          await expect(
            inventory.reserve(orderId, [
              { variantId: shirt, quantity: 5 },
              { variantId: cap, quantity: 2 },
            ]),
          ).rejects.toThrow(new InsufficientStockError([cap]));
          // The caller goes on in the same transaction, as a late payment without stock does.
          await inventory.reserve(newId<'Order'>(), [
            { variantId: later, quantity: 1 },
          ]);
        }),
      );

      expect((await stockOf(shirt)).reserved).toBe(0);
      expect((await stockOf(cap)).reserved).toBe(0);
      expect((await stockOf(later)).reserved).toBe(1);
      expect(await prisma.reservation.count({ where: { orderId } })).toBe(0);
      expect(await prisma.reservation.count()).toBe(1);
    });

    it('tells whether each line can be fulfilled with what is not reserved', async () => {
      const [shirt, cap, unstocked] = await stocked(5, 3, 0);
      await reserve(newId<'Order'>(), [{ variantId: shirt, quantity: 3 }]);

      const answer = await inventory.canFulfill([
        { variantId: shirt, quantity: 2 },
        { variantId: cap, quantity: 2 },
        { variantId: cap, quantity: 2 },
        { variantId: unstocked, quantity: 1 },
      ]);

      expect(answer).toEqual(
        new Map([
          [shirt, true],
          [cap, false],
          [unstocked, false],
        ]),
      );
      expect(
        (await inventory.canFulfill([{ variantId: shirt, quantity: 3 }])).get(
          shirt,
        ),
      ).toBe(false);
    });
  });

  describe('confirming and freeing', () => {
    it('confirms once: the units leave the stock with a SALE movement for the order (UC-INV-06)', async () => {
      const [shirt, cap] = await stocked(10, 4);
      const orderId = newId<'Order'>();
      const { reservationId } = await reserve(orderId, [
        { variantId: shirt, quantity: 3 },
        { variantId: cap, quantity: 1 },
      ]);

      expect(await commit(orderId)).toBe('committed');
      expect(await commit(orderId)).toBe('already-committed');

      expect(await stockOf(shirt)).toMatchObject({ onHand: 7, reserved: 0 });
      expect(await stockOf(cap)).toMatchObject({ onHand: 3, reserved: 0 });
      expect(
        await prisma.stockMovement.findMany({
          where: { type: 'SALE' },
          select: {
            quantity: true,
            onHandAfter: true,
            orderId: true,
            actorId: true,
          },
          orderBy: { quantity: 'asc' },
        }),
      ).toEqual([
        { quantity: -3, onHandAfter: 7, orderId, actorId: null },
        { quantity: -1, onHandAfter: 3, orderId, actorId: null },
      ]);
      expect(
        await prisma.reservation.findUniqueOrThrow({
          where: { id: reservationId },
        }),
      ).toMatchObject({ status: 'COMMITTED', version: 2 });
      await expectLedgerBalanced(shirt);
      await expectLedgerBalanced(cap);
    });

    it('confirms a reservation past its expiry while the job has not ended it (ADR-0128)', async () => {
      const [shirt] = await stocked(10);
      const orderId = newId<'Order'>();
      await reserve(orderId, [{ variantId: shirt, quantity: 2 }]);
      current += 21 * MINUTE;

      expect(await commit(orderId)).toBe('committed');
      expect((await stockOf(shirt)).onHand).toBe(8);
    });

    it('frees once: the units are available again (UC-INV-07)', async () => {
      const [shirt] = await stocked(10);
      const orderId = newId<'Order'>();
      const { reservationId } = await reserve(orderId, [
        { variantId: shirt, quantity: 4 },
      ]);

      expect(await release(orderId)).toBe(true);
      expect(await release(orderId)).toBe(false);
      expect(await commit(orderId)).toBe('not-active');

      expect(await stockOf(shirt)).toMatchObject({ onHand: 10, reserved: 0 });
      expect(
        await prisma.reservation.findUniqueOrThrow({
          where: { id: reservationId },
        }),
      ).toMatchObject({ status: 'RELEASED', version: 2 });
      expect(
        await prisma.stockMovement.count({ where: { type: 'SALE' } }),
      ).toBe(0);
    });

    it('expires once: the units are available again and it can no longer be confirmed (UC-INV-08, ADR-0136)', async () => {
      const [shirt] = await stocked(10);
      const orderId = newId<'Order'>();
      const { reservationId } = await reserve(orderId, [
        { variantId: shirt, quantity: 4 },
      ]);
      current += 21 * MINUTE;
      const expiredAt = current + 1;

      expect(await expire(orderId)).toBe(true);
      expect(await expire(orderId)).toBe(false);
      expect(await release(orderId)).toBe(false);
      expect(await commit(orderId)).toBe('not-active');

      expect(await stockOf(shirt)).toMatchObject({ onHand: 10, reserved: 0 });
      expect(
        await prisma.reservation.findUniqueOrThrow({
          where: { id: reservationId },
        }),
      ).toMatchObject({
        status: 'EXPIRED',
        version: 2,
        updatedAt: new Date(expiredAt),
      });
      expect(
        await prisma.stockItem.findFirstOrThrow({
          where: { variantId: shirt },
        }),
      ).toMatchObject({ updatedAt: new Date(expiredAt) });
    });

    it('opens a new reservation for an order whose reservation ended, as a late payment does (ADR-0012)', async () => {
      const [shirt] = await stocked(10);
      const orderId = newId<'Order'>();
      const first = await reserve(orderId, [{ variantId: shirt, quantity: 2 }]);
      await release(orderId);

      const second = await reserve(orderId, [
        { variantId: shirt, quantity: 2 },
      ]);

      expect(second.reservationId).not.toBe(first.reservationId);
      expect(await commit(orderId)).toBe('committed');
      expect(await stockOf(shirt)).toMatchObject({ onHand: 8, reserved: 0 });
    });

    it('answers an order without a reservation as not active', async () => {
      expect(await commit(newId<'Order'>())).toBe('not-active');
      expect(await release(newId<'Order'>())).toBe(false);
    });
  });

  describe('at the same time', () => {
    it('never reserves more than is available, whatever the number of orders (UC-INV-05)', async () => {
      const [shirt] = await stocked(10);
      const { id } = await stockOf(shirt);
      // Hold the stock item, which every reservation updates, so all of them wait for it at once.
      const client = await holder();
      await client.query(
        'SELECT id FROM stock_items WHERE id = $1 FOR UPDATE',
        [id],
      );

      const results = Promise.allSettled(
        Array.from({ length: 5 }, () =>
          reserve(newId<'Order'>(), [{ variantId: shirt, quantity: 3 }]),
        ),
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
      expect(await stockOf(shirt)).toMatchObject({ onHand: 10, reserved: 9 });
      expect(await prisma.reservation.count()).toBe(3);
    });

    it('reserves lines asked in opposite orders without either waiting for the other forever (BR-INV-14)', async () => {
      const [first, second] = await stocked(10, 10);
      const [low] = [await stockOf(first), await stockOf(second)].sort(
        (a, b) => (a.id < b.id ? -1 : 1),
      );
      // Hold the stock item that comes first by ID, so both reservations are under way at once.
      const client = await holder();
      await client.query(
        'SELECT id FROM stock_items WHERE id = $1 FOR UPDATE',
        [low.id],
      );

      const results = Promise.all([
        reserve(newId<'Order'>(), [
          { variantId: first, quantity: 1 },
          { variantId: second, quantity: 1 },
        ]),
        reserve(newId<'Order'>(), [
          { variantId: second, quantity: 1 },
          { variantId: first, quantity: 1 },
        ]),
      ]);
      await waitForLockWaiters(2);
      await client.query('COMMIT');
      await client.end();
      await results;

      expect((await stockOf(first)).reserved).toBe(2);
      expect((await stockOf(second)).reserved).toBe(2);
    });

    it('lets only one of a confirmation and a release of the same reservation through', async () => {
      const [shirt] = await stocked(10);
      const orderId = newId<'Order'>();
      const { reservationId } = await reserve(orderId, [
        { variantId: shirt, quantity: 4 },
      ]);
      // Hold the reservation, which both change, so both are under way when it is released.
      const client = await holder();
      await client.query(
        'SELECT id FROM reservations WHERE id = $1 FOR UPDATE',
        [reservationId],
      );

      const results = Promise.all([commit(orderId), release(orderId)]);
      await waitForLockWaiters(2);
      await client.query('COMMIT');
      await client.end();
      const [committed, released] = await results;

      expect(
        [committed === 'committed', released].filter(Boolean),
      ).toHaveLength(1);
      const stock = await stockOf(shirt);
      expect(stock.reserved).toBe(0);
      expect(stock.onHand).toBe(committed === 'committed' ? 6 : 10);
      await expectLedgerBalanced(shirt);
    });

    it('opens one reservation for two reservations of the same order at the same time', async () => {
      const [shirt] = await stocked(10);
      const { id } = await stockOf(shirt);
      const orderId = newId<'Order'>();
      // Hold the stock item: the first reservation waits there, the second one for the first one's insert.
      const client = await holder();
      await client.query(
        'SELECT id FROM stock_items WHERE id = $1 FOR UPDATE',
        [id],
      );

      const results = Promise.all([
        reserve(orderId, [{ variantId: shirt, quantity: 2 }]),
        reserve(orderId, [{ variantId: shirt, quantity: 2 }]),
      ]);
      await waitForLockWaiters(2);
      await client.query('COMMIT');
      await client.end();
      const [a, b] = await results;

      expect(a).toEqual(b);
      expect((await stockOf(shirt)).reserved).toBe(2);
      expect(await prisma.reservation.count()).toBe(1);
    });
  });

  describe('several warehouses (ADR-0160)', () => {
    /** Another warehouse; only an active one takes stock and orders. */
    async function warehouse(
      code: string,
      priority: number,
      status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE',
    ): Promise<WarehouseId> {
      const id = newId<'Warehouse'>();
      await prisma.warehouse.create({
        data: { id, code, name: code, status, priority },
      });
      return id;
    }

    /** Units of the variant received in an active warehouse through Inventory. */
    async function stockIn(
      warehouseId: WarehouseId,
      variantId: VariantId,
      quantity: number,
    ): Promise<void> {
      await cls.run(() =>
        moduleRef
          .get(StockEntries)
          .receive({ variantId, warehouseId, quantity }, newId()),
      );
    }

    const reservedIn = async (warehouseId: WarehouseId, variantId: VariantId) =>
      (
        await prisma.stockItem.findUnique({
          where: { variantId_warehouseId: { variantId, warehouseId } },
          select: { reserved: true },
        })
      )?.reserved ?? 0;

    it('reserves the whole order in the first active warehouse that holds it, by priority and then code', async () => {
      const [shirt, cap] = await stocked(1, 0);
      const north = await warehouse('NORTE', 2);
      const archive = await warehouse('ARCHIVO', 2);
      const closed = await warehouse('CERRADO', 1, 'INACTIVE');
      for (const id of [north, archive]) {
        await stockIn(id, shirt, 5);
        await stockIn(id, cap, 1);
      }
      // The inactive one comes first and holds the whole order, but sells nothing.
      await prisma.stockItem.createMany({
        data: [shirt, cap].map((variantId) => ({
          id: newId(),
          variantId,
          warehouseId: closed,
          onHand: 9,
          reserved: 0,
        })),
      });
      const orderId = newId<'Order'>();

      await reserve(orderId, [
        { variantId: shirt, quantity: 2 },
        { variantId: cap, quantity: 1 },
      ]);
      await commit(orderId);

      expect(await cls.run(() => inventory.allocationOf(orderId))).toEqual([
        {
          warehouseId: archive,
          lines: expect.arrayContaining([
            { variantId: shirt, quantity: 2 },
            { variantId: cap, quantity: 1 },
          ]),
        },
      ]);
      expect(await stockOf(shirt)).toMatchObject({ onHand: 1, reserved: 0 });
      expect(
        await prisma.stockItem.findMany({
          where: { warehouseId: { in: [north, closed] } },
          select: { onHand: true, reserved: true },
        }),
      ).toEqual(
        expect.arrayContaining([
          { onHand: 5, reserved: 0 },
          { onHand: 1, reserved: 0 },
          { onHand: 9, reserved: 0 },
        ]),
      );
    });

    it('answers what the closest warehouse leaves out when none holds the order, and reserves nothing', async () => {
      const [shirt, cap] = await stocked(2, 0);
      const north = await warehouse('NORTE', 2);
      await stockIn(north, cap, 1);
      const lines = [
        { variantId: shirt, quantity: 2 },
        { variantId: cap, quantity: 1 },
      ];

      // The main warehouse leaves out the cap and the north one the shirts: the main one comes first.
      await expect(reserve(newId<'Order'>(), lines)).rejects.toThrow(
        new InsufficientStockError([cap]),
      );
      expect(await cls.run(() => inventory.canFulfill(lines))).toEqual(
        new Map([
          [shirt, true],
          [cap, true],
        ]),
      );
      expect(await cls.run(() => inventory.canFulfillTogether(lines))).toEqual(
        new Map([
          [shirt, true],
          [cap, false],
        ]),
      );
      expect([
        await reservedIn(MAIN, shirt),
        await reservedIn(north, cap),
      ]).toEqual([0, 0]);
      expect(await prisma.reservationLine.count()).toBe(0);
    });

    it('answers no allocation for an order whose stock was not confirmed', async () => {
      const [shirt] = await stocked(3);
      const orderId = newId<'Order'>();
      await reserve(orderId, [{ variantId: shirt, quantity: 1 }]);

      expect(await cls.run(() => inventory.allocationOf(orderId))).toEqual([]);
    });

    it('reserves in the next warehouse the order that lost the last units of the first one to another', async () => {
      const [shirt] = await stocked(1);
      const north = await warehouse('NORTE', 2);
      await stockIn(north, shirt, 1);
      const { id } = await stockOf(shirt);
      // Hold the main warehouse's units: both orders read them as available and wait to reserve them.
      const client = await holder();
      await client.query(
        'SELECT id FROM stock_items WHERE id = $1 FOR UPDATE',
        [id],
      );
      const [first, second] = [newId<'Order'>(), newId<'Order'>()];

      const results = Promise.all([
        reserve(first, [{ variantId: shirt, quantity: 1 }]),
        reserve(second, [{ variantId: shirt, quantity: 1 }]),
      ]);
      await waitForLockWaiters(2);
      await client.query('COMMIT');
      await client.end();
      await results;
      await commit(first);
      await commit(second);

      const allocations = await Promise.all(
        [first, second].map((orderId) =>
          cls.run(() => inventory.allocationOf(orderId)),
        ),
      );
      expect(
        allocations.map(([{ warehouseId }]) => warehouseId).sort(),
      ).toEqual([MAIN, north].sort());
      expect(await stockOf(shirt)).toMatchObject({ onHand: 0, reserved: 0 });
      expect(await reservedIn(north, shirt)).toBe(0);
      expect(
        await prisma.stockItem.findUniqueOrThrow({
          where: {
            variantId_warehouseId: { variantId: shirt, warehouseId: north },
          },
          select: { onHand: true },
        }),
      ).toEqual({ onHand: 0 });
    });
  });
});
