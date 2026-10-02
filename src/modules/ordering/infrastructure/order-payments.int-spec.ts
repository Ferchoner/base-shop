import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import pg from 'pg';
import { waitForLockWaiters } from '../../../../test/support/lock-waiters.js';
import { AppCacheModule } from '../../../platform/cache/app-cache.module.js';
import { ClockModule } from '../../../platform/clock/clock.module.js';
import { validateEnvironment } from '../../../platform/config/environment.js';
import { DomainEventDispatcher } from '../../../platform/events/domain-event-dispatcher.js';
import { EventsModule } from '../../../platform/events/events.module.js';
import { IdempotencyModule } from '../../../platform/http/idempotency/idempotency.module.js';
import { RateLimitingModule } from '../../../platform/http/rate-limiting/rate-limiting.module.js';
import { MailModule } from '../../../platform/mail/mail.module.js';
import { PersistenceModule } from '../../../platform/persistence/persistence.module.js';
import { PrismaService } from '../../../platform/persistence/prisma.service.js';
import {
  newId,
  toId,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import { AuditModule } from '../../audit/index.js';
import { PaymentsFacade } from '../../payments/index.js';
import { Checkout } from '../application/checkout.use-case.js';
import { OrderLifecycle } from '../application/order-lifecycle.use-case.js';
import { OrderPaymentRequests } from '../application/order-payment-requests.use-case.js';
import type { OrderId, VariantId } from '../domain/order.js';
import { OrderRepository } from '../domain/order.repository.js';
import type { PublicCode } from '../domain/public-code.js';
import { OrderingModule } from '../ordering.module.js';

/** The list and the warehouse their migrations create (ADR-0125, ADR-0127). */
const DEFAULT_LIST = '01a0f4f2-bb5f-770a-a269-105d21861fe0';
const MAIN = '01a0f54d-639d-7173-a3ff-f510cd91429d';

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

/** Paying orders at the same time, against PostgreSQL 18 (T-190 part a, ADR-0134). */
describe('Ordering: payments of an order at the same time (T-190)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cls: ClsService;
  let requests: OrderPaymentRequests;
  let previous: string | undefined;

  beforeAll(async () => {
    previous = process.env.MANUAL_PAYMENTS_ENABLED;
    process.env.MANUAL_PAYMENTS_ENABLED = 'true';
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
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    cls = moduleRef.get(ClsService);
    requests = moduleRef.get(OrderPaymentRequests);
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
    if (previous === undefined) delete process.env.MANUAL_PAYMENTS_ENABLED;
    else process.env.MANUAL_PAYMENTS_ENABLED = previous;
  });

  afterEach(async () => {
    await moduleRef.get(DomainEventDispatcher).whenIdle();
    await prisma.auditLog.deleteMany({
      where: {
        action: {
          in: [
            'payments.manual-capture',
            'payments.manual-refund',
            'orders.cancel',
          ],
        },
      },
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

  /** A guest order of one unit of a new variant: $100.00 plus $99.00 of shipping. */
  async function placed(): Promise<{
    id: OrderId;
    code: PublicCode;
    cartId: string;
  }> {
    const productId = newId();
    const variantId = newId<'Variant'>();
    await prisma.product.create({
      data: {
        id: productId,
        title: 'Camisa de lino',
        slug: `camisa-${productId.slice(-12)}`,
        status: 'PUBLISHED',
        variants: {
          create: {
            id: variantId,
            sku: `SKU-${variantId.slice(-12)}`.toUpperCase(),
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
        variantId,
        periods: {
          create: {
            id: newId(),
            amount: 10_000,
            effectiveFrom: new Date(Date.now() - 86_400_000),
            createdBy: newId(),
          },
        },
      },
    });
    await prisma.stockItem.create({
      data: { id: newId(), variantId, warehouseId: MAIN, onHand: 5 },
    });
    const cartId = newId<'Cart'>();
    await prisma.cart.create({
      data: {
        id: cartId,
        status: 'ACTIVE',
        lastActivityAt: new Date(),
        lines: { create: { variantId: variantId as VariantId, quantity: 1 } },
      },
    });
    const id = await run(() =>
      moduleRef.get(Checkout).placeOrder({
        guestCartId: cartId,
        contactEmail: 'cliente@example.com',
        shippingAddress: ADDRESS,
        privacyNoticeVersion: '2026-09',
        expectedTotal: 19_900,
      }),
    );
    const { publicCode } = await prisma.order.findUniqueOrThrow({
      where: { id },
    });
    return { id, code: publicCode as PublicCode, cartId };
  }

  const capture = (orderId: OrderId) =>
    run(() =>
      requests.captureManually({
        orderId,
        staffId: newId<'User'>(),
        reference: 'Ticket 00452',
        note: null,
      }),
    );

  /** Runs the operations while another transaction holds the row of the order, or of its payment. */
  async function holding(
    id: string,
    operations: () => Promise<unknown>[],
    table: 'orders' | 'payments' = 'orders',
  ): Promise<PromiseSettledResult<unknown>[]> {
    const client = new pg.Client({
      connectionString: process.env.DATABASE_URL,
    });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT 1 FROM ${table} WHERE id = $1 FOR UPDATE`, [
        id,
      ]);
      const started = operations();
      await waitForLockWaiters(started.length);
      await client.query('COMMIT');
      return await Promise.allSettled(started);
    } finally {
      await client.end();
    }
  }

  /** How each operation ended: `ok`, or the name of the error it threw. */
  const outcomes = (results: PromiseSettledResult<unknown>[]) =>
    results
      .map((result) =>
        result.status === 'fulfilled'
          ? 'ok'
          : (result.reason as Error).constructor.name,
      )
      .sort();

  it('registers a payment made in the store once when the staff registers it twice at once', async () => {
    const { id } = await placed();

    const results = await holding(id, () => [capture(id), capture(id)]);
    await moduleRef.get(DomainEventDispatcher).whenIdle();

    expect(outcomes(results)).toEqual(['InvalidStateTransitionError', 'ok']);
    const payments = await prisma.payment.findMany({
      include: { attempts: true },
    });
    expect(payments).toHaveLength(1);
    expect(payments[0].attempts.map(({ status }) => status).sort()).toEqual([
      'CAPTURED',
      'PENDING',
    ]);
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id } })).status,
    ).toBe('PAID');
  });

  it('starts one payment when the buyer asks twice at once', async () => {
    const { id, code, cartId } = await placed();
    const start = () =>
      run(() =>
        requests.startPayment({
          publicCode: code,
          payer: { guestCartId: cartId as never },
          provider: 'MANUAL',
        }),
      );

    const results = await holding(id, () => [start(), start()]);

    expect(
      results
        .map((result) =>
          result.status === 'fulfilled'
            ? (result.value as { started: boolean }).started
            : 'failed',
        )
        .sort(),
    ).toEqual([false, true]);
    expect(await prisma.payment.count()).toBe(1);
  });

  it('keeps the order and its payment consistent when a cancellation and a payment arrive together', async () => {
    const { id } = await placed();
    const cancel = () =>
      run(() =>
        moduleRef.get(OrderLifecycle).cancel({
          orderId: id,
          actorId: newId<'User'>(),
          reason: 'Duplicado',
          restock: false,
          version: 1,
        }),
      );

    const [cancelled, paid] = await holding(id, () => [cancel(), capture(id)]);
    await moduleRef.get(DomainEventDispatcher).whenIdle();

    const order = await prisma.order.findUniqueOrThrow({ where: { id } });
    const payment = await prisma.payment.findFirst();
    expect(cancelled.status).toBe('fulfilled');
    expect(order.status).toBe('CANCELLED');
    if (paid.status === 'fulfilled') {
      // The payment went first: the cancellation found the order still unpaid, and the payment came back with
      // its refund started (ADR-0133, ADR-0135).
      expect(payment?.status).toBe('CAPTURED');
      expect(order.paidAt).not.toBeNull();
      expect(
        await prisma.refund.findMany({
          select: { status: true, amount: true },
        }),
      ).toEqual([{ status: 'PENDING', amount: 19_900 }]);
    } else {
      expect((paid.reason as Error).constructor.name).toBe(
        'InvalidStateTransitionError',
      );
      expect(payment).toBeNull();
      expect(order.paidAt).toBeNull();
    }
  });

  const cancel = (orderId: OrderId, version: number) =>
    run(() =>
      moduleRef.get(OrderLifecycle).cancel({
        orderId,
        actorId: newId<'User'>(),
        reason: 'Sin stock',
        restock: false,
        version,
      }),
    );

  it('cancels the payment the buyer started when the order is cancelled before the staff registers it', async () => {
    const { id, code, cartId } = await placed();
    await run(() =>
      requests.startPayment({
        publicCode: code,
        payer: { guestCartId: cartId as never },
        provider: 'MANUAL',
      }),
    );

    const [cancelled, paid] = await holding(id, () => [
      cancel(id, 1),
      capture(id),
    ]);
    await moduleRef.get(DomainEventDispatcher).whenIdle();

    const order = await prisma.order.findUniqueOrThrow({ where: { id } });
    const payment = await prisma.payment.findFirstOrThrow();
    const refunds = await prisma.refund.findMany({ select: { status: true } });
    expect(cancelled.status).toBe('fulfilled');
    expect(order.status).toBe('CANCELLED');
    if (paid.status === 'fulfilled') {
      // The payment went first: it is captured and its refund started (ADR-0135).
      expect(payment.status).toBe('CAPTURED');
      expect(refunds).toEqual([{ status: 'PENDING' }]);
    } else {
      // The cancellation went first: the payment started is cancelled, and nobody can pay it.
      expect((paid.reason as Error).constructor.name).toBe(
        'InvalidStateTransitionError',
      );
      expect(payment.status).toBe('CANCELLED');
      expect(refunds).toEqual([]);
    }
  });

  it('registers the refund of a cancelled order once when the staff registers it twice at once, and refunds the order once', async () => {
    const { id } = await placed();
    await capture(id);
    await moduleRef.get(DomainEventDispatcher).whenIdle();
    const { version } = await prisma.order.findUniqueOrThrow({ where: { id } });
    await cancel(id, version);
    const payment = await prisma.payment.findFirstOrThrow();
    const register = () =>
      run(() =>
        moduleRef
          .get(PaymentsFacade)
          .registerManualRefund(toId<'Payment'>(payment.id), {
            reference: 'Devolución 00087',
            note: null,
            version: payment.version,
            registeredBy: newId<'User'>(),
          }),
      );

    const results = await holding(
      payment.id,
      () => [register(), register()],
      'payments',
    );
    await moduleRef.get(DomainEventDispatcher).whenIdle();

    expect(outcomes(results)).toEqual(['VersionConflictError', 'ok']);
    expect(
      await prisma.refund.findMany({ select: { status: true, amount: true } }),
    ).toEqual([{ status: 'COMPLETED', amount: 19_900 }]);
    expect(
      await prisma.auditLog.count({
        where: { action: 'payments.manual-refund' },
      }),
    ).toBe(1);
    const order = await prisma.order.findUniqueOrThrow({
      where: { id },
      include: { statusHistory: true },
    });
    expect(order.status).toBe('REFUNDED');
    expect(
      order.statusHistory.filter(({ toStatus }) => toStatus === 'REFUNDED'),
    ).toHaveLength(1);
    const read = await run(() =>
      moduleRef
        .get(TransactionManager)
        .run(() => moduleRef.get(OrderRepository).lock(id)),
    );
    expect(read?.snapshot.refundedAt).toEqual(order.refundedAt);
    expect(order.refundedAt).not.toBeNull();
  });
});
