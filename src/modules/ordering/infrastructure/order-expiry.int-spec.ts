import { Injectable } from '@nestjs/common';
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
import { OnDomainEvent } from '../../../platform/events/on-domain-event.decorator.js';
import { IdempotencyModule } from '../../../platform/http/idempotency/idempotency.module.js';
import { RateLimitingModule } from '../../../platform/http/rate-limiting/rate-limiting.module.js';
import { MailModule } from '../../../platform/mail/mail.module.js';
import { PersistenceModule } from '../../../platform/persistence/persistence.module.js';
import { PrismaService } from '../../../platform/persistence/prisma.service.js';
import { Clock, Money, newId } from '../../../shared-kernel/index.js';
import { AuditModule } from '../../audit/index.js';
import { Checkout } from '../application/checkout.use-case.js';
import {
  type ExpiryRun,
  type OrderExpired,
  OrderExpiry,
} from '../application/order-expiry.use-case.js';
import { OrderLifecycle } from '../application/order-lifecycle.use-case.js';
import type { OrderId, VariantId } from '../domain/order.js';
import { OrderRepository } from '../domain/order.repository.js';
import { OrderingModule } from '../ordering.module.js';
import { OrderExpiryJob } from './order-expiry.job.js';

/** The list and the warehouse their migrations create (ADR-0125, ADR-0127). */
const DEFAULT_LIST = '01a0f4f2-bb5f-770a-a269-105d21861fe0';
const MAIN = '01a0f54d-639d-7173-a3ff-f510cd91429d';
const START = Date.parse('2026-10-01T12:00:00.000Z');
const MINUTE = 60_000;
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

/** What Shopping will do with `OrderExpired` in T-181: here it only keeps the events. */
@Injectable()
class ExpiredOrders {
  readonly events: OrderExpired[] = [];

  @OnDomainEvent('OrderExpired')
  onOrderExpired(event: OrderExpired): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
}

/** Unpaid orders that expire, against PostgreSQL 18 (T-230, ADR-0136). */
describe('Ordering: expiration of unpaid orders (T-230)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cls: ClsService;
  // A clock that moves forward a second on each reading; tests move it further to make orders due.
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
      providers: [ExpiredOrders],
    })
      .overrideProvider(Clock)
      .useValue(clock)
      .compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    cls = moduleRef.get(ClsService);
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
    moduleRef.get(ExpiredOrders).events.length = 0;
  });

  afterEach(async () => {
    await moduleRef.get(DomainEventDispatcher).whenIdle();
    await prisma.auditLog.deleteMany({
      where: { action: { startsWith: 'orders.' } },
    });
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
  const expireDue = () => run(() => moduleRef.get(OrderExpiry).expireDue());
  const idle = () => moduleRef.get(DomainEventDispatcher).whenIdle();

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

  /** A guest order of one unit, placed now: $100.00 plus $99.00 of shipping, due in 20 minutes. */
  async function placed(variantId: VariantId): Promise<OrderId> {
    const cartId = newId<'Cart'>();
    await prisma.cart.create({
      data: {
        id: cartId,
        status: 'ACTIVE',
        lastActivityAt: new Date(current),
        lines: { create: { variantId, quantity: 1 } },
      },
    });
    return run(() =>
      moduleRef.get(Checkout).placeOrder({
        guestCartId: cartId,
        contactEmail: 'cliente@example.com',
        shippingAddress: ADDRESS,
        privacyNoticeVersion: '2026-09',
        expectedTotal: 19_900,
      }),
    );
  }

  const pay = (orderId: OrderId) =>
    run(() =>
      moduleRef.get(OrderLifecycle).recordPayment({
        orderId,
        amount: Money.of(19_900, 'MXN'),
        capturedAt: CAPTURED,
      }),
    );

  const stockOf = (variantId: VariantId) =>
    prisma.stockItem.findFirstOrThrow({
      where: { variantId },
      select: { onHand: true, reserved: true },
    });

  const reservationsOf = async (orderId: OrderId) =>
    (
      await prisma.reservation.findMany({
        where: { orderId },
        orderBy: { createdAt: 'asc' },
      })
    ).map(({ status }) => status);

  /** Runs the operations while another transaction holds the row of the order. */
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

  it('expires the unpaid orders whose payment is due, with their reservations, and announces each once (UC-ORD-10, UC-INV-08)', async () => {
    const shirt = await variant(5);
    const due = await placed(shirt);
    current = START + 10 * MINUTE;
    const notDue = await placed(shirt);
    current = START + 25 * MINUTE;

    expect(await expireDue()).toEqual({ expired: 1, failed: 0 });
    expect(await expireDue()).toEqual({ expired: 0, failed: 0 });
    await idle();

    const row = await prisma.order.findUniqueOrThrow({
      where: { id: due },
      include: { statusHistory: { orderBy: { occurredAt: 'asc' } } },
    });
    expect(row).toMatchObject({ status: 'EXPIRED', version: 2 });
    expect(row.expiredAt!.getTime()).toBeGreaterThan(START + 25 * MINUTE);
    expect(row.statusHistory.at(-1)).toMatchObject({
      fromStatus: 'PENDING_PAYMENT',
      toStatus: 'EXPIRED',
      actorId: null,
      reason: null,
      occurredAt: row.expiredAt,
    });
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: notDue } })).status,
    ).toBe('PENDING_PAYMENT');
    expect([await reservationsOf(due), await reservationsOf(notDue)]).toEqual([
      ['EXPIRED'],
      ['ACTIVE'],
    ]);
    expect(await stockOf(shirt)).toEqual({ onHand: 5, reserved: 1 });
    expect(moduleRef.get(ExpiredOrders).events).toEqual([
      {
        eventId: expect.any(String),
        eventType: 'OrderExpired',
        occurredAt: row.expiredAt,
        orderId: due,
        customerId: null,
        sourceCartId: row.sourceCartId,
        lines: [{ variantId: shirt, quantity: 1 }],
      },
    ]);
  });

  it('expires the due orders when its job runs (ADR-0101)', async () => {
    const shirt = await variant(5);
    const id = await placed(shirt);
    current = START + 25 * MINUTE;

    await moduleRef.get(OrderExpiryJob).run();

    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id } })).status,
    ).toBe('EXPIRED');
  });

  it('finds the due unpaid orders oldest first, up to the limit', async () => {
    const shirt = await variant(5);
    const first = await placed(shirt);
    current = START + 5 * MINUTE;
    const second = await placed(shirt);
    current = START + 10 * MINUTE;
    const paid = await placed(shirt);
    expect(await pay(paid)).toBe('paid');
    const dueAt = (at: number, limit: number) =>
      run(() =>
        moduleRef.get(OrderRepository).dueForExpiry(new Date(at), limit),
      );

    expect(await dueAt(START + 40 * MINUTE, 5)).toEqual([first, second]);
    expect(await dueAt(START + 40 * MINUTE, 1)).toEqual([first]);
    expect(await dueAt(START + 22 * MINUTE, 5)).toEqual([first]);
    expect(await dueAt(START + 19 * MINUTE, 5)).toEqual([]);
  });

  describe('at the same time', () => {
    it('keeps a payment that arrives as the order expires, whichever goes first (ADR-0012)', async () => {
      const shirt = await variant(5);
      const id = await placed(shirt);
      current = START + 25 * MINUTE;

      const [expiry, payment] = await holding(id, () => [expireDue(), pay(id)]);

      expect(payment).toEqual({ status: 'fulfilled', value: 'paid' });
      expect(
        (await prisma.order.findUniqueOrThrow({ where: { id } })).status,
      ).toBe('PAID');
      expect(await stockOf(shirt)).toEqual({ onHand: 4, reserved: 0 });
      const { expired } = (expiry as PromiseFulfilledResult<ExpiryRun>).value;
      // The job went first: the payment came late and reserved again; otherwise it found the order paid.
      expect(await reservationsOf(id)).toEqual(
        expired === 1 ? ['EXPIRED', 'COMMITTED'] : ['COMMITTED'],
      );
    });

    it('lets a cancellation and the expiration of the same order through one after the other', async () => {
      const shirt = await variant(5);
      const id = await placed(shirt);
      current = START + 25 * MINUTE;
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

      const [expiry, cancelled] = await holding(id, () => [
        expireDue(),
        cancel(),
      ]);

      const order = await prisma.order.findUniqueOrThrow({ where: { id } });
      expect(await stockOf(shirt)).toEqual({ onHand: 5, reserved: 0 });
      if (order.status === 'EXPIRED') {
        // The job went first: the staff read an older version, and must read the order again.
        expect(expiry).toEqual({
          status: 'fulfilled',
          value: { expired: 1, failed: 0 },
        });
        expect(
          ((cancelled as PromiseRejectedResult).reason as Error).constructor
            .name,
        ).toBe('VersionConflictError');
        expect(await reservationsOf(id)).toEqual(['EXPIRED']);
      } else {
        expect(order.status).toBe('CANCELLED');
        expect(cancelled.status).toBe('fulfilled');
        expect(expiry).toEqual({
          status: 'fulfilled',
          value: { expired: 0, failed: 0 },
        });
        expect(await reservationsOf(id)).toEqual(['RELEASED']);
      }
    });
  });
});
