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
import { newId } from '../../../shared-kernel/index.js';
import { AuditModule } from '../../audit/index.js';
import { Checkout } from '../application/checkout.use-case.js';
import { OrderLifecycle } from '../application/order-lifecycle.use-case.js';
import { OrderPaymentRequests } from '../application/order-payment-requests.use-case.js';
import type { OrderId, VariantId } from '../domain/order.js';
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
      where: { action: { in: ['payments.manual-capture', 'orders.cancel'] } },
    });
    await prisma.paymentAttempt.deleteMany();
    await prisma.payment.deleteMany();
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

  async function holding(
    orderId: OrderId,
    operations: () => Promise<unknown>[],
  ): Promise<PromiseSettledResult<unknown>[]> {
    const client = new pg.Client({
      connectionString: process.env.DATABASE_URL,
    });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT 1 FROM orders WHERE id = $1 FOR UPDATE', [
        orderId,
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
      // The payment went first: the cancellation found the order still unpaid, and the payment waits for its
      // refund (ADR-0133).
      expect(payment?.status).toBe('CAPTURED');
      expect(order.paidAt).not.toBeNull();
    } else {
      expect((paid.reason as Error).constructor.name).toBe(
        'InvalidStateTransitionError',
      );
      expect(payment).toBeNull();
      expect(order.paidAt).toBeNull();
    }
  });
});
