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
  InvalidStateTransitionError,
  Money,
  newId,
  TransactionManager,
  VersionConflictError,
} from '../../../shared-kernel/index.js';
import { AuditModule } from '../../audit/index.js';
import { Checkout } from '../application/checkout.use-case.js';
import { OrderExpiry } from '../application/order-expiry.use-case.js';
import { OrderLifecycle } from '../application/order-lifecycle.use-case.js';
import { Order, type OrderId, type VariantId } from '../domain/order.js';
import { OrderRepository } from '../domain/order.repository.js';
import { OrderingModule } from '../ordering.module.js';

/** The list and the warehouse their migrations create (ADR-0125, ADR-0127). */
const DEFAULT_LIST = '01a0f4f2-bb5f-770a-a269-105d21861fe0';
const MAIN = '01a0f54d-639d-7173-a3ff-f510cd91429d';
const START = Date.parse('2026-10-01T12:00:00.000Z');
const CAPTURED = new Date('2026-10-01T12:30:00.000Z');

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

/** The life of an order against PostgreSQL 18, after it is placed (T-180 part b, ADR-0133). */
describe('Ordering: life of an order (T-180)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cls: ClsService;
  let lifecycle: OrderLifecycle;
  // A clock that moves forward a second on each reading.
  let current = START;
  const clock = {
    now: () => {
      current += 1_000;
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
    lifecycle = moduleRef.get(OrderLifecycle);
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
    await prisma.auditLog.deleteMany({
      where: { action: { startsWith: 'orders.' } },
    });
    await prisma.paymentAttempt.deleteMany();
    await prisma.refund.deleteMany();
    await prisma.payment.deleteMany();
    await prisma.shipmentItem.deleteMany();
    await prisma.shipment.deleteMany();
    await prisma.orderStatusHistory.deleteMany();
    await prisma.orderLine.deleteMany();
    await prisma.order.deleteMany();
    await prisma.reservation.deleteMany();
    await prisma.stockMovement.deleteMany();
    await prisma.cartLine.deleteMany();
    await prisma.cart.deleteMany();
    await prisma.pricePeriod.deleteMany();
    await prisma.variantPrice.deleteMany();
    await prisma.stockItem.deleteMany();
    await prisma.productVariant.deleteMany();
    await prisma.product.deleteMany();
  });

  const run = <T>(work: () => Promise<T>) => cls.run(work);

  /** A published variant priced at $100.00, with `stock` units. */
  async function variant(stock = 5): Promise<VariantId> {
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
    await prisma.stockItem.create({
      data: { id: newId(), variantId: id, warehouseId: MAIN, onHand: stock },
    });
    return id;
  }

  /** A guest order of one unit of each variant: $100.00 a unit plus $99.00 of shipping. */
  function placed(...variants: VariantId[]): Promise<OrderId> {
    return placedWith(
      variants.map((variantId) => ({ variantId, quantity: 1 })),
    );
  }

  async function placedWith(
    lines: readonly { variantId: VariantId; quantity: number }[],
  ): Promise<OrderId> {
    const cartId = newId<'Cart'>();
    await prisma.cart.create({
      data: {
        id: cartId,
        status: 'ACTIVE',
        lastActivityAt: new Date(START),
        lines: {
          create: lines.map(({ variantId, quantity }, index) => ({
            variantId,
            quantity,
            createdAt: new Date(START + index),
            updatedAt: new Date(START + index),
          })),
        },
      },
    });
    const units = lines.reduce((sum, { quantity }) => sum + quantity, 0);
    return run(() =>
      moduleRef.get(Checkout).placeOrder({
        guestCartId: cartId,
        contactEmail: 'cliente@example.com',
        shippingAddress: ADDRESS,
        privacyNoticeVersion: '2026-09',
        expectedTotal: units * 10_000 + 9_900,
      }),
    );
  }

  /** The order runs out of time, and the expiration job ends it with its reservation (UC-ORD-10, ADR-0136). */
  async function expire(orderId: OrderId): Promise<void> {
    current += 21 * 60_000;
    await run(() => moduleRef.get(OrderExpiry).expireDue());
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status,
    ).toBe('EXPIRED');
  }

  const pay = (orderId: OrderId, amount: number) =>
    run(() =>
      lifecycle.recordPayment({
        orderId,
        amount: Money.of(amount, 'MXN'),
        capturedAt: CAPTURED,
      }),
    );

  const stockOf = (variantId: VariantId) =>
    prisma.stockItem.findFirstOrThrow({
      where: { variantId },
      select: { onHand: true, reserved: true },
    });

  async function holder(): Promise<pg.Client> {
    const client = new pg.Client({
      connectionString: process.env.DATABASE_URL,
    });
    await client.connect();
    await client.query('BEGIN');
    return client;
  }

  /** How each operation ended: its result, or the name of the error it threw. */
  const outcomes = (results: PromiseSettledResult<unknown>[]) =>
    results
      .map((result) =>
        result.status === 'fulfilled'
          ? String(result.value)
          : (result.reason as Error).constructor.name,
      )
      .sort();

  describe('persistence', () => {
    it('saves a change with one more version and a history entry per status change', async () => {
      const shirt = await variant();
      const id = await placed(shirt);

      expect(await pay(id, 19_900)).toBe('paid');

      const row = await prisma.order.findUniqueOrThrow({
        where: { id },
        include: { statusHistory: { orderBy: { occurredAt: 'asc' } } },
      });
      expect(row).toMatchObject({
        status: 'PAID',
        paidAt: CAPTURED,
        version: 2,
      });
      expect(row.updatedAt.getTime()).toBeGreaterThan(row.placedAt.getTime());
      expect(
        row.statusHistory.map(({ fromStatus, toStatus, actorId }) => [
          fromStatus,
          toStatus,
          actorId,
        ]),
      ).toEqual([
        [null, 'PENDING_PAYMENT', null],
        ['PENDING_PAYMENT', 'PAID', null],
      ]);
    });

    it('saves nothing for an order without changes', async () => {
      const shirt = await variant();
      const id = await placed(shirt);
      const orders = moduleRef.get(OrderRepository);
      const transactions = moduleRef.get(TransactionManager);

      await run(() =>
        transactions.run(async () => {
          await orders.save((await orders.lock(id))!, new Date(START));
        }),
      );

      expect(
        (await prisma.order.findUniqueOrThrow({ where: { id } })).version,
      ).toBe(1);
    });

    it('rejects saving an order read at another version', async () => {
      const shirt = await variant();
      const id = await placed(shirt);
      const orders = moduleRef.get(OrderRepository);
      const transactions = moduleRef.get(TransactionManager);

      await expect(
        run(() =>
          transactions.run(async () => {
            const order = (await orders.lock(id))!;
            const stale = Order.restore({ ...order.snapshot, version: 7 });
            stale.cancel(newId<'User'>(), 'Duplicado', new Date(START));
            await orders.save(stale, new Date(START));
          }),
        ),
      ).rejects.toThrow(new VersionConflictError(1));
      expect(
        (await prisma.order.findUniqueOrThrow({ where: { id } })).status,
      ).toBe('PENDING_PAYMENT');
    });
  });

  describe('its shipment (UC-SHI-03, ADR-0140)', () => {
    const shipmentOf = (orderId: OrderId) =>
      prisma.shipment.findUnique({
        where: { orderId },
        include: { items: { orderBy: { orderLineId: 'asc' } } },
      });

    it('is created PENDING when the order is paid, from the active warehouse, to its address and with its lines', async () => {
      const [shirt, cap] = [await variant(), await variant()];
      const id = await placedWith([
        { variantId: shirt, quantity: 2 },
        { variantId: cap, quantity: 1 },
      ]);

      expect(await pay(id, 39_900)).toBe('paid');

      const order = await prisma.order.findUniqueOrThrow({
        where: { id },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });
      expect(await shipmentOf(id)).toMatchObject({
        orderCode: order.publicCode,
        warehouseId: MAIN,
        status: 'PENDING',
        destination: order.shippingAddress,
        items: order.lines.map((line) => ({
          orderLineId: line.id,
          sku: line.sku,
          productName: line.productName,
          quantity: line.quantity,
        })),
      });
      expect(
        order.lines.map(({ variantId, quantity }) => [variantId, quantity]),
      ).toEqual([
        [shirt, 2],
        [cap, 1],
      ]);
    });

    it('is created by a late payment with stock and by the retry of the fulfillment, never while the order waits for stock', async () => {
      const stocked = await variant(5);
      const late = await placed(stocked);
      const short = await variant(1);
      const waiting = await placed(short);
      await expire(late);
      await expire(waiting);
      await prisma.stockItem.updateMany({
        where: { variantId: short },
        data: { onHand: 0 },
      });

      expect(await pay(late, 19_900)).toBe('paid');
      expect(await pay(waiting, 19_900)).toBe('awaiting-manual-fulfillment');
      const beforeRetry = await shipmentOf(waiting);
      await prisma.stockItem.updateMany({
        where: { variantId: short },
        data: { onHand: 1 },
      });
      await run(() =>
        lifecycle.retryFulfillment({
          orderId: waiting,
          actorId: newId<'User'>(),
          version: 3,
        }),
      );

      expect((await shipmentOf(late))?.status).toBe('PENDING');
      expect(beforeRetry).toBeNull();
      expect((await shipmentOf(waiting))?.status).toBe('PENDING');
    });

    it('is cancelled with its paid order, and an order whose shipment left is not cancelled', async () => {
      const shirt = await variant(5);
      const [kept, left] = [await placed(shirt), await placed(shirt)];
      await pay(kept, 19_900);
      await pay(left, 19_900);
      await prisma.shipment.update({
        where: { orderId: left },
        data: {
          status: 'DISPATCHED',
          ownDelivery: true,
          dispatchedAt: new Date(START),
        },
      });
      // Payments captured both: the refund of a cancellation needs it.
      for (const orderId of [kept, left]) {
        await prisma.payment.create({
          data: {
            id: newId(),
            orderId,
            orderCode: 'K7M4Q9XA',
            provider: 'MANUAL',
            status: 'CAPTURED',
            amount: 19_900,
            capturedAmount: 19_900,
            currency: 'MXN',
            capturedAt: CAPTURED,
          },
        });
      }
      const cancel = (orderId: OrderId) =>
        run(() =>
          lifecycle.cancel({
            orderId,
            actorId: newId<'User'>(),
            reason: 'Sin stock',
            restock: false,
            version: 2,
          }),
        );

      await cancel(kept);
      await expect(cancel(left)).rejects.toThrow(
        new InvalidStateTransitionError('DISPATCHED', 'cancel'),
      );

      expect(await shipmentOf(kept)).toMatchObject({
        status: 'CANCELLED',
        cancelledAt: expect.any(Date),
      });
      expect(
        (await prisma.order.findUniqueOrThrow({ where: { id: left } })).status,
      ).toBe('PAID');
      expect(
        await prisma.refund.count({
          where: { payment: { orderId: left } },
        }),
      ).toBe(0);
    });
  });

  it('leaves a late payment waiting for stock, reserving nothing of the lines that had it (ADR-0012)', async () => {
    const shirt = await variant(5);
    const cap = await variant(1);
    const id = await placed(shirt, cap);
    await expire(id);
    await prisma.stockItem.updateMany({
      where: { variantId: cap },
      data: { onHand: 0 },
    });

    expect(await pay(id, 29_900)).toBe('awaiting-manual-fulfillment');

    expect(await stockOf(shirt)).toEqual({ onHand: 5, reserved: 0 });
    expect(
      await prisma.reservation.count({
        where: { orderId: id, status: { not: 'EXPIRED' } },
      }),
    ).toBe(0);
    expect(
      await prisma.order.findUniqueOrThrow({ where: { id } }),
    ).toMatchObject({
      status: 'AWAITING_MANUAL_FULFILLMENT',
      paidAt: CAPTURED,
    });
  });

  describe('at the same time', () => {
    it('applies a payment that arrives twice at once only once', async () => {
      const shirt = await variant(5);
      const id = await placed(shirt);
      const client = await holder();
      try {
        await client.query('SELECT 1 FROM orders WHERE id = $1 FOR UPDATE', [
          id,
        ]);
        const payments = [pay(id, 19_900), pay(id, 19_900)];
        await waitForLockWaiters(2);
        await client.query('COMMIT');

        expect(outcomes(await Promise.allSettled(payments))).toEqual([
          'already-processed',
          'paid',
        ]);
      } finally {
        await client.end();
      }
      expect(await stockOf(shirt)).toEqual({ onHand: 4, reserved: 0 });
    });

    it('lets a cancellation and a payment of the same order through one after the other', async () => {
      const shirt = await variant(5);
      const id = await placed(shirt);
      // Payments captured it: the event the handler gets.
      await prisma.payment.create({
        data: {
          id: newId(),
          orderId: id,
          orderCode: 'K7M4Q9XA',
          provider: 'MANUAL',
          status: 'CAPTURED',
          amount: 19_900,
          capturedAmount: 19_900,
          currency: 'MXN',
          capturedAt: CAPTURED,
        },
      });
      const client = await holder();
      let settled: PromiseSettledResult<unknown>[];
      try {
        await client.query('SELECT 1 FROM orders WHERE id = $1 FOR UPDATE', [
          id,
        ]);
        const operations = [
          run(() =>
            lifecycle.cancel({
              orderId: id,
              actorId: newId<'User'>(),
              reason: 'Duplicado',
              restock: false,
              version: 1,
            }),
          ),
          pay(id, 19_900),
        ];
        await waitForLockWaiters(2);
        await client.query('COMMIT');
        settled = await Promise.allSettled(operations);
      } finally {
        await client.end();
      }
      const order = await prisma.order.findUniqueOrThrow({ where: { id } });
      const refunds = await prisma.refund.findMany({
        select: { status: true, amount: true },
      });
      // Whichever went first, the order, its refund and the stock agree.
      if (order.status === 'CANCELLED') {
        // The cancellation went first: the payment waits for its refund (ADR-0135).
        expect(settled[1]).toEqual({
          status: 'fulfilled',
          value: 'recorded-on-cancelled',
        });
        expect(order.paidAt).toEqual(CAPTURED);
        expect(refunds).toEqual([{ status: 'PENDING', amount: 19_900 }]);
        expect(await stockOf(shirt)).toEqual({ onHand: 5, reserved: 0 });
      } else {
        // The payment went first: the staff read an older version, and must read the order again.
        expect(order.status).toBe('PAID');
        expect(settled[0].status).toBe('rejected');
        expect(
          ((settled[0] as PromiseRejectedResult).reason as Error).constructor
            .name,
        ).toBe('VersionConflictError');
        expect(refunds).toEqual([]);
        expect(await stockOf(shirt)).toEqual({ onHand: 4, reserved: 0 });
      }
    });
  });
});
