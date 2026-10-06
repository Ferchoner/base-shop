import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import pg from 'pg';
import { waitForLockWaiters } from '../../../../test/support/lock-waiters.js';
import { AppCacheModule } from '../../../platform/cache/app-cache.module.js';
import { ClockModule } from '../../../platform/clock/clock.module.js';
import { validateEnvironment } from '../../../platform/config/environment.js';
import { EventsModule } from '../../../platform/events/events.module.js';
import { IdempotencyModule } from '../../../platform/http/idempotency/idempotency.module.js';
import { RateLimitingModule } from '../../../platform/http/rate-limiting/rate-limiting.module.js';
import { MailModule } from '../../../platform/mail/mail.module.js';
import { PersistenceModule } from '../../../platform/persistence/persistence.module.js';
import { PrismaService } from '../../../platform/persistence/prisma.service.js';
import {
  Clock,
  Money,
  newId,
  NotFoundError,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import { AuditModule } from '../../audit/index.js';
import { OrderExpiry } from '../application/order-expiry.use-case.js';
import { OrderLifecycle } from '../application/order-lifecycle.use-case.js';
import {
  StaffCheckout,
  type StaffOrderInput,
} from '../application/staff-checkout.use-case.js';
import type {
  OrderId,
  StaffId,
  VariantId,
  WarehouseId,
} from '../domain/order.js';
import { OrderRepository } from '../domain/order.repository.js';
import { OrderingModule } from '../ordering.module.js';

/** The list and the warehouse their migrations create (ADR-0125, ADR-0127). */
const DEFAULT_LIST = '01a0f4f2-bb5f-770a-a269-105d21861fe0';
const MAIN = '01a0f54d-639d-7173-a3ff-f510cd91429d' as WarehouseId;
const START = Date.parse('2026-10-06T12:00:00.000Z');

const ADDRESS = {
  recipientName: 'María López Hernández',
  phone: '4431234567',
  street: 'Av. Madero Poniente',
  exteriorNumber: '123',
  interiorNumber: null,
  neighborhood: 'Centro',
  postalCode: '58000',
  stateCode: '16',
  municipalityCode: '16053',
  city: null,
  references: null,
};

/**
 * The orders the staff places in the physical store against PostgreSQL 18 (T-187 part a, ADR-0161): with the stock
 * only from the warehouse the staff chose, never another one.
 */
describe('Ordering: orders of the staff in the store (T-187)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cls: ClsService;
  let checkout: StaffCheckout;
  let current = START;
  const clock = {
    now: () => {
      current += 1_000;
      return new Date(current);
    },
  };
  const staffId = newId<'User'>() as StaffId;

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
        RateLimitingModule,
        IdempotencyModule,
        MailModule,
        AuditModule,
        OrderingModule,
      ],
    })
      .overrideProvider(Clock)
      .useValue(clock)
      .compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    cls = moduleRef.get(ClsService);
    checkout = moduleRef.get(StaffCheckout);
    await prisma.geoState.upsert({
      where: { code: '16' },
      create: { code: '16', name: 'Michoacán de Ocampo' },
      update: {},
    });
    await prisma.geoMunicipality.upsert({
      where: { code: '16053' },
      create: {
        code: '16053',
        stateCode: '16',
        name: 'Morelia',
        isActive: true,
      },
      update: {},
    });
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(() => {
    current = START;
  });

  afterEach(async () => {
    await prisma.shipmentItem.deleteMany();
    await prisma.shipment.deleteMany();
    await prisma.orderStatusHistory.deleteMany();
    await prisma.orderLine.deleteMany();
    await prisma.order.deleteMany();
    await prisma.reservation.deleteMany();
    await prisma.stockMovement.deleteMany();
    await prisma.pricePeriod.deleteMany();
    await prisma.variantPrice.deleteMany();
    await prisma.stockItem.deleteMany();
    await prisma.warehouse.deleteMany({ where: { id: { not: MAIN } } });
    await prisma.productVariant.deleteMany();
    await prisma.product.deleteMany();
    await prisma.auditLog.deleteMany({ where: { action: 'orders.place' } });
  });

  const run = <T>(work: () => Promise<T>) => cls.run(work);

  /** A second active warehouse, the store's, after the main one by priority. */
  async function storeWarehouse(): Promise<WarehouseId> {
    const id = newId<'Warehouse'>();
    await prisma.warehouse.create({
      data: {
        id,
        code: 'TIENDA',
        name: 'Tienda',
        status: 'ACTIVE',
        priority: 2,
      },
    });
    return id;
  }

  /** A published variant priced at $100.00, with the units of each warehouse. */
  async function variant(units: [WarehouseId, number][]): Promise<VariantId> {
    const productId = newId();
    const id = newId<'Variant'>();
    await prisma.product.create({
      data: {
        id: productId,
        title: 'Camisa de lino',
        slug: `camisa-${productId.slice(-12)}`,
        status: 'PUBLISHED',
        variants: {
          create: {
            id,
            sku: `SKU-${id.slice(-12)}`.toUpperCase(),
            options: { talla: 'M' },
            status: 'ACTIVE',
          },
        },
      },
    });
    await prisma.variantPrice.create({
      data: {
        id: newId(),
        priceListId: DEFAULT_LIST,
        variantId: id,
        periods: {
          create: {
            id: newId(),
            amount: 10_000,
            effectiveFrom: new Date(START - 86_400_000),
            createdBy: newId(),
          },
        },
      },
    });
    for (const [warehouseId, onHand] of units) {
      await prisma.stockItem.create({
        data: { id: newId(), variantId: id, warehouseId, onHand },
      });
    }
    return id;
  }

  /** A guest order of `units` of the variant, from the warehouse: $100.00 a unit plus $99.00 of shipping. */
  const order = (
    variantId: VariantId,
    units: number,
    warehouseId: WarehouseId,
  ): StaffOrderInput => ({
    staffId,
    warehouseId,
    lines: [{ variantId, quantity: units }],
    buyer: {
      contactEmail: 'cliente@example.com',
      privacyNoticeVersion: '2026-09',
    },
    shippingAddress: ADDRESS,
    expectedTotal: units * 10_000 + 9_900,
  });

  /** A field of the stock items of the variant, by warehouse. */
  const byWarehouse = async (
    variantId: VariantId,
    field: 'reserved' | 'onHand',
  ) =>
    Object.fromEntries(
      (await prisma.stockItem.findMany({ where: { variantId } })).map(
        (item) => [item.warehouseId, item[field]],
      ),
    );
  const reservedOf = (variantId: VariantId) =>
    byWarehouse(variantId, 'reserved');

  /** 409 `insufficient-stock` with these variants, as Inventory answers it (ADR-0161). */
  const short = (...variantIds: VariantId[]) => ({
    code: 'insufficient-stock',
    details: {
      lines: variantIds.map((variantId) => ({ variantId, canFulfill: false })),
    },
  });

  it('places a store order with its stock from the chosen warehouse, though the main one holds it too, and audits it', async () => {
    const store = await storeWarehouse();
    const shirt = await variant([
      [MAIN, 5],
      [store, 5],
    ]);

    const id = await run(() => checkout.place(order(shirt, 2, store)));

    const row = await prisma.order.findUniqueOrThrow({
      where: { id },
      include: { statusHistory: true },
    });
    expect(row).toMatchObject({
      status: 'PENDING_PAYMENT',
      channel: 'STORE',
      sourceCartId: null,
      placedBy: staffId,
      warehouseId: store,
      customerId: null,
      contactEmail: 'cliente@example.com',
      privacyNoticeVersion: '2026-09',
      grandTotal: 29_900,
    });
    // The staff member placed it (ADR-0161).
    expect(row.statusHistory).toEqual([
      expect.objectContaining({
        fromStatus: null,
        toStatus: 'PENDING_PAYMENT',
        actorId: staffId,
      }),
    ]);
    expect(await reservedOf(shirt)).toEqual({ [MAIN]: 0, [store]: 2 });
    // And the repository reads it back as it saved it.
    const read = await run(() =>
      moduleRef
        .get(TransactionManager)
        .run(() => moduleRef.get(OrderRepository).lock(id)),
    );
    expect(read?.snapshot).toMatchObject({
      channel: 'STORE',
      sourceCartId: null,
      placedBy: staffId,
      warehouseId: store,
    });
    expect(
      await prisma.auditLog.findMany({
        where: { action: 'orders.place' },
        select: { resourceType: true, resourceId: true, changes: true },
      }),
    ).toEqual([
      {
        resourceType: 'order',
        resourceId: id,
        changes: {
          status: { from: null, to: 'PENDING_PAYMENT' },
          channel: { from: null, to: 'STORE' },
          warehouseId: { from: null, to: store },
        },
      },
    ]);
  });

  it('answers what the chosen warehouse leaves out, never taking the stock of another one', async () => {
    const store = await storeWarehouse();
    const shirt = await variant([
      [MAIN, 5],
      [store, 1],
    ]);

    await expect(
      run(() => checkout.place(order(shirt, 2, store))),
    ).rejects.toMatchObject(short(shirt));
    expect(await prisma.order.count()).toBe(0);
    expect(await reservedOf(shirt)).toEqual({ [MAIN]: 0, [store]: 0 });
    // The quote says it the same way.
    const quote = await run(() =>
      checkout.quote({
        lines: [{ variantId: shirt, quantity: 2 }],
        warehouseId: store,
      }),
    );
    expect(quote.lines[0].canFulfill).toBe(false);
  });

  it('answers a warehouse that is not active, or does not exist, as not found', async () => {
    const shirt = await variant([[MAIN, 5]]);
    const inactive = newId<'Warehouse'>();
    await prisma.warehouse.create({
      data: { id: inactive, code: 'VIEJO', name: 'Viejo', status: 'INACTIVE' },
    });

    for (const warehouseId of [inactive, newId<'Warehouse'>()]) {
      await expect(
        run(() => checkout.place(order(shirt, 1, warehouseId))),
      ).rejects.toThrow(new NotFoundError('Warehouse', warehouseId));
      await expect(
        run(() =>
          checkout.quote({
            lines: [{ variantId: shirt, quantity: 1 }],
            warehouseId,
          }),
        ),
      ).rejects.toThrow(new NotFoundError('Warehouse', warehouseId));
    }
    expect(await prisma.order.count()).toBe(0);
  });

  it('gives the last unit of the store to one order only, and the other reserves nothing anywhere else', async () => {
    const store = await storeWarehouse();
    const last = await variant([
      [MAIN, 5],
      [store, 1],
    ]);
    const client = new pg.Client({
      connectionString: process.env.DATABASE_URL,
    });
    await client.connect();
    await client.query('BEGIN');
    try {
      await client.query(
        'SELECT 1 FROM stock_items WHERE variant_id = $1 AND warehouse_id = $2 FOR UPDATE',
        [last, store],
      );
      const placements = [1, 2].map(() =>
        run(() => checkout.place(order(last, 1, store))),
      );
      await waitForLockWaiters(2);
      await client.query('COMMIT');

      const results = await Promise.allSettled(placements);
      expect(
        results
          .map((result) =>
            result.status === 'fulfilled'
              ? 'ok'
              : (result.reason as Error).constructor.name,
          )
          .sort(),
      ).toEqual(['InsufficientStockError', 'ok']);
      expect(
        results.flatMap((result) =>
          result.status === 'rejected' ? [result.reason] : [],
        ),
      ).toMatchObject([short(last)]);
    } finally {
      await client.end();
    }
    expect(await prisma.order.count()).toBe(1);
    expect(await reservedOf(last)).toEqual({ [MAIN]: 0, [store]: 1 });
  });

  it('keeps an online order with a cart and a store order with its staff member and warehouse (orders_channel_check)', async () => {
    const store = await storeWarehouse();
    const shirt = await variant([[store, 5]]);
    const id = await run(() => checkout.place(order(shirt, 1, store)));

    for (const change of [
      prisma.$executeRaw`UPDATE orders SET placed_by = NULL WHERE id = ${id}::uuid`,
      prisma.$executeRaw`UPDATE orders SET warehouse_id = NULL WHERE id = ${id}::uuid`,
      prisma.$executeRaw`UPDATE orders SET source_cart_id = ${newId()}::uuid WHERE id = ${id}::uuid`,
      prisma.$executeRaw`UPDATE orders SET channel = 'ONLINE' WHERE id = ${id}::uuid`,
      prisma.$executeRaw`UPDATE orders SET channel = 'ONLINE', source_cart_id = ${newId()}::uuid WHERE id = ${id}::uuid`,
    ]) {
      await expect(change).rejects.toThrow(/orders_channel_check/);
    }
    // An online order with its cart and nothing of the store passes.
    await prisma.$executeRaw`
      UPDATE orders SET channel = 'ONLINE', source_cart_id = ${newId()}::uuid, placed_by = NULL, warehouse_id = NULL
       WHERE id = ${id}::uuid`;
  });

  it('reserves a late payment of a store order again in its warehouse, and waits for the staff once it is inactive', async () => {
    const store = await storeWarehouse();
    const shirt = await variant([
      [MAIN, 5],
      [store, 5],
    ]);
    const expired = async (): Promise<OrderId> => {
      const id = await run(() => checkout.place(order(shirt, 1, store)));
      current += 21 * 60_000;
      await run(() => moduleRef.get(OrderExpiry).expireDue());
      return id;
    };
    const pay = (id: OrderId) =>
      run(() =>
        moduleRef.get(OrderLifecycle).recordPayment({
          orderId: id,
          amount: Money.of(19_900, 'MXN'),
          capturedAt: new Date(current),
        }),
      );

    const first = await expired();
    expect(await pay(first)).toBe('paid');
    // The unit left the store, not the main warehouse, first by priority.
    expect(await byWarehouse(shirt, 'onHand')).toEqual({
      [MAIN]: 5,
      [store]: 4,
    });

    const second = await expired();
    await prisma.warehouse.update({
      where: { id: store },
      data: { status: 'INACTIVE' },
    });
    expect(await pay(second)).toBe('awaiting-manual-fulfillment');
    expect(await reservedOf(shirt)).toEqual({ [MAIN]: 0, [store]: 0 });
  });
});
