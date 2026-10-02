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
  toId,
} from '../../../shared-kernel/index.js';
import { AuditModule } from '../../audit/index.js';
import { Checkout } from '../application/checkout.use-case.js';
import { OrderLifecycle } from '../application/order-lifecycle.use-case.js';
import { OrderRestocks } from '../application/order-restocks.use-case.js';
import type { OrderId, VariantId } from '../domain/order.js';
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

/** The restock of an order against PostgreSQL 18 (T-161, UC-INV-09, ADR-0052, ADR-0142). */
describe('Ordering: restock of an order (T-161)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cls: ClsService;
  let lifecycle: OrderLifecycle;
  let restocks: OrderRestocks;
  // A clock that moves forward a second on each reading.
  let current = START;
  const clock = {
    now: () => {
      current += 1_000;
      return new Date(current);
    },
  };
  const staff = newId<'User'>();

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
    restocks = moduleRef.get(OrderRestocks);
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
    await prisma.reservationLine.deleteMany();
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

  /** A published variant priced at $100.00, with 5 units. */
  async function variant(): Promise<VariantId> {
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
      data: { id: newId(), variantId: id, warehouseId: MAIN, onHand: 5 },
    });
    return id;
  }

  /** A guest order of these lines, paid unless `paid` is false: $100.00 a unit plus $99.00 of shipping. */
  async function order(
    lines: readonly { variantId: VariantId; quantity: number }[],
    paid = true,
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
    const total =
      lines.reduce((sum, { quantity }) => sum + quantity, 0) * 10_000 + 9_900;
    const id = await run(() =>
      moduleRef.get(Checkout).placeOrder({
        guestCartId: cartId,
        contactEmail: 'cliente@example.com',
        shippingAddress: ADDRESS,
        privacyNoticeVersion: '2026-09',
        expectedTotal: total,
      }),
    );
    if (!paid) return id;
    await run(() =>
      lifecycle.recordPayment({
        orderId: id,
        amount: Money.of(total, 'MXN'),
        capturedAt: CAPTURED,
      }),
    );
    // Payments captured it: the refund of a cancellation needs it.
    await prisma.payment.create({
      data: {
        id: newId(),
        orderId: id,
        orderCode: 'K7M4Q9XA',
        provider: 'MANUAL',
        status: 'CAPTURED',
        amount: total,
        capturedAmount: total,
        currency: 'MXN',
        capturedAt: CAPTURED,
      },
    });
    return id;
  }

  async function cancel(orderId: OrderId, restock = false): Promise<void> {
    const { version } = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
    });
    await run(() =>
      lifecycle.cancel({
        orderId,
        actorId: staff,
        reason: 'Sin stock',
        restock,
        version,
      }),
    );
  }

  const linesOf = async (orderId: OrderId) =>
    (
      await prisma.orderLine.findMany({
        where: { orderId },
        orderBy: { lineNumber: 'asc' },
      })
    ).map(({ id }) => toId<'OrderLine'>(id));

  const restock = (
    orderId: OrderId,
    lines: readonly { orderLineId: string; quantity: number }[],
    reasonCode: 'ORDER_CANCELLED' | 'SHIPMENT_RETURNED' = 'ORDER_CANCELLED',
  ) =>
    run(() =>
      restocks.restock({
        orderId,
        reasonCode,
        lines: lines.map(({ orderLineId, quantity }) => ({
          orderLineId: toId<'OrderLine'>(orderLineId),
          quantity,
        })),
        note: 'Regresó en su caja',
        actorId: staff,
      }),
    );

  const onHandOf = async (variantId: VariantId) =>
    (await prisma.stockItem.findFirstOrThrow({ where: { variantId } })).onHand;

  /** The ledger of the variant adds up to `onHand` (BR-INV-13). */
  async function expectLedgerBalanced(variantId: VariantId): Promise<void> {
    const item = await prisma.stockItem.findFirstOrThrow({
      where: { variantId },
    });
    const { _sum } = await prisma.stockMovement.aggregate({
      where: { stockItemId: item.id },
      _sum: { quantity: true },
    });
    expect(_sum.quantity ?? 0).toBe(item.onHand - 5);
  }

  it('brings back every line of a paid order cancelled with its restock, in the same operation (ADR-0052)', async () => {
    const [shirt, cap] = [await variant(), await variant()];
    const id = await order([
      { variantId: shirt, quantity: 2 },
      { variantId: cap, quantity: 1 },
    ]);
    expect([await onHandOf(shirt), await onHandOf(cap)]).toEqual([3, 4]);

    await cancel(id, true);

    expect([await onHandOf(shirt), await onHandOf(cap)]).toEqual([5, 5]);
    const [first, second] = await linesOf(id);
    expect(
      await prisma.stockMovement.findMany({
        where: { type: 'RESTOCK' },
        orderBy: { orderLineId: 'asc' },
        select: {
          quantity: true,
          reasonCode: true,
          note: true,
          orderId: true,
          orderLineId: true,
          actorId: true,
        },
      }),
    ).toEqual([
      {
        quantity: 2,
        reasonCode: 'ORDER_CANCELLED',
        note: 'Sin stock',
        orderId: id,
        orderLineId: first,
        actorId: staff,
      },
      {
        quantity: 1,
        reasonCode: 'ORDER_CANCELLED',
        note: 'Sin stock',
        orderId: id,
        orderLineId: second,
        actorId: staff,
      },
    ]);
    expect(
      (
        await prisma.auditLog.findMany({
          where: { resourceId: id },
          orderBy: { occurredAt: 'asc' },
        })
      ).map(({ action }) => action),
    ).toEqual(['orders.cancel', 'orders.restock']);
    await expectLedgerBalanced(shirt);
    await expectLedgerBalanced(cap);
  });

  it('brings back a cancelled order line by line, never beyond what each line sold', async () => {
    const [shirt, cap] = [await variant(), await variant()];
    const id = await order([
      { variantId: shirt, quantity: 2 },
      { variantId: cap, quantity: 1 },
    ]);
    await cancel(id);
    const [first, second] = await linesOf(id);

    await restock(id, [{ orderLineId: first, quantity: 1 }]);
    const movements = await restock(id, [
      { orderLineId: first, quantity: 1 },
      { orderLineId: second, quantity: 1 },
    ]);
    await expect(
      restock(id, [{ orderLineId: first, quantity: 1 }]),
    ).rejects.toMatchObject({
      code: 'restock-not-allowed',
      details: {
        lines: [{ orderLineId: first, sold: 2, restocked: 2, requested: 1 }],
      },
    });

    expect([await onHandOf(shirt), await onHandOf(cap)]).toEqual([5, 5]);
    expect(movements).toEqual([
      expect.objectContaining({
        type: 'RESTOCK',
        quantity: 1,
        onHandAfter: 5,
        reasonCode: 'ORDER_CANCELLED',
        note: 'Regresó en su caja',
        orderId: id,
        orderLineId: first,
        actorId: staff,
      }),
      expect.objectContaining({ quantity: 1, orderLineId: second }),
    ]);
    expect(
      await prisma.auditLog.count({
        where: { resourceId: id, action: 'orders.restock' },
      }),
    ).toBe(2);
    await expectLedgerBalanced(shirt);
  });

  it('brings nothing back of an order cancelled before its stock was confirmed', async () => {
    const shirt = await variant();
    const id = await order([{ variantId: shirt, quantity: 1 }], false);
    await cancel(id);
    const [line] = await linesOf(id);

    await expect(
      restock(id, [{ orderLineId: line, quantity: 1 }]),
    ).rejects.toMatchObject({
      code: 'restock-not-allowed',
      details: {
        lines: [{ orderLineId: line, sold: 0, restocked: 0, requested: 1 }],
      },
    });
    expect(await onHandOf(shirt)).toBe(5);
    expect(
      await prisma.stockMovement.count({ where: { type: 'RESTOCK' } }),
    ).toBe(0);
  });

  it('brings back the goods of a returned shipment, and nothing while the shipment has not come back (ADR-0053)', async () => {
    const shirt = await variant();
    const id = await order([{ variantId: shirt, quantity: 1 }]);
    const [line] = await linesOf(id);

    await expect(
      restock(id, [{ orderLineId: line, quantity: 1 }], 'SHIPMENT_RETURNED'),
    ).rejects.toThrow(
      new InvalidStateTransitionError('PENDING', 'restock the return'),
    );
    await prisma.shipment.update({
      where: { orderId: id },
      data: {
        status: 'RETURNED',
        ownDelivery: true,
        dispatchedAt: new Date(START),
        failedAt: new Date(START),
        returnedAt: new Date(START),
      },
    });
    await prisma.order.update({
      where: { id },
      data: { status: 'SHIPPED', shippedAt: new Date(START) },
    });
    await expect(
      restock(id, [{ orderLineId: line, quantity: 1 }]),
    ).rejects.toThrow(new InvalidStateTransitionError('SHIPPED', 'restock'));

    const [movement] = await restock(
      id,
      [{ orderLineId: line, quantity: 1 }],
      'SHIPMENT_RETURNED',
    );

    expect(movement).toMatchObject({
      reasonCode: 'SHIPMENT_RETURNED',
      orderLineId: line,
    });
    expect(await onHandOf(shirt)).toBe(5);
  });

  it('brings a line back once when two restocks of it arrive at once beyond what it sold', async () => {
    const shirt = await variant();
    const id = await order([{ variantId: shirt, quantity: 1 }]);
    await cancel(id);
    const [line] = await linesOf(id);
    const client = new pg.Client({
      connectionString: process.env.DATABASE_URL,
    });
    await client.connect();
    let settled: PromiseSettledResult<unknown>[];
    try {
      await client.query('BEGIN');
      await client.query('SELECT 1 FROM orders WHERE id = $1 FOR UPDATE', [id]);
      const restocking = [
        restock(id, [{ orderLineId: line, quantity: 1 }]),
        restock(id, [{ orderLineId: line, quantity: 1 }]),
      ];
      await waitForLockWaiters(2);
      await client.query('COMMIT');
      settled = await Promise.allSettled(restocking);
    } finally {
      await client.end();
    }

    expect(
      settled
        .map((result) =>
          result.status === 'fulfilled'
            ? 'ok'
            : (result.reason as Error).constructor.name,
        )
        .sort(),
    ).toEqual(['RestockLimitError', 'ok']);
    expect(await onHandOf(shirt)).toBe(5);
    await expectLedgerBalanced(shirt);
  });
});
