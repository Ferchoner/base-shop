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
  TransactionManager,
} from '../../../shared-kernel/index.js';
import { AuditModule } from '../../audit/index.js';
import {
  Checkout,
  type GuestOrderInput,
} from '../application/checkout.use-case.js';
import { OrderingQueries } from '../application/ordering.queries.js';
import {
  type CartId,
  type CustomerId,
  Order,
  type OrderId,
  priceLine,
  type VariantId,
} from '../domain/order.js';
import { OrderRepository } from '../domain/order.repository.js';
import { TotalMismatchError } from '../domain/ordering-errors.js';
import { type PublicCode, parsePublicCode } from '../domain/public-code.js';
import { OrderingModule } from '../ordering.module.js';

/** The list and the warehouse their migrations create (ADR-0125, ADR-0127). */
const DEFAULT_LIST = '01a0f4f2-bb5f-770a-a269-105d21861fe0';
const MAIN = '01a0f54d-639d-7173-a3ff-f510cd91429d';
const START = Date.parse('2026-10-01T12:00:00.000Z');

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
 * The checkout against PostgreSQL 18, with Shopping, Catalog, Pricing, Inventory, Shipping, Identity and Geo
 * behind their facades (T-180, ADR-0132).
 */
describe('Ordering: checkout (T-180)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cls: ClsService;
  let checkout: Checkout;
  let queries: OrderingQueries;
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
    checkout = moduleRef.get(Checkout);
    queries = moduleRef.get(OrderingQueries);
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
    await prisma.orderStatusHistory.deleteMany();
    await prisma.orderLine.deleteMany();
    await prisma.order.deleteMany();
    await prisma.reservation.deleteMany();
    await prisma.cartLine.deleteMany();
    await prisma.cart.deleteMany();
    await prisma.pricePeriod.deleteMany();
    await prisma.variantPrice.deleteMany();
    await prisma.stockItem.deleteMany();
    await prisma.productVariant.deleteMany();
    await prisma.product.deleteMany();
    await prisma.user.deleteMany();
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

  /** An active cart with these lines, of a guest or of a customer. */
  async function cart(
    lines: { variantId: VariantId; quantity: number }[],
    owner: CustomerId | null = null,
  ): Promise<CartId> {
    const id = newId<'Cart'>();
    await prisma.cart.create({
      data: {
        id,
        ownerUserId: owner,
        status: 'ACTIVE',
        lastActivityAt: new Date(START),
        lines: {
          create: lines.map((line, index) => ({
            ...line,
            createdAt: new Date(START + index),
            updatedAt: new Date(START + index),
          })),
        },
      },
    });
    return id;
  }

  async function verifiedCustomer(): Promise<CustomerId> {
    const id = newId<'User'>();
    await prisma.user.create({
      data: {
        id,
        type: 'CUSTOMER',
        email: `${id}@example.com`,
        firstNames: 'Ana',
        lastNames: 'Pérez',
        passwordHash: 'not-a-real-hash',
        emailVerifiedAt: new Date(START),
      },
    });
    return id;
  }

  /** A guest order of the cart: $100.00 a unit plus $99.00 of shipping. */
  const guestOrder = (cartId: CartId, units: number): GuestOrderInput => ({
    guestCartId: cartId,
    contactEmail: 'cliente@example.com',
    shippingAddress: ADDRESS,
    privacyNoticeVersion: '2026-09',
    expectedTotal: units * 10_000 + 9_900,
  });

  const reserved = async (variantId: VariantId) =>
    (await prisma.stockItem.findFirstOrThrow({ where: { variantId } }))
      .reserved;

  async function holder(): Promise<pg.Client> {
    const client = new pg.Client({
      connectionString: process.env.DATABASE_URL,
    });
    await client.connect();
    await client.query('BEGIN');
    return client;
  }

  /** Why each operation ended: `ok`, or the name of the error it threw. */
  const outcomes = (results: PromiseSettledResult<unknown>[]) =>
    results
      .map((result) =>
        result.status === 'fulfilled'
          ? 'ok'
          : (result.reason as Error).constructor.name,
      )
      .sort();

  describe('persistence', () => {
    it('saves the order with its snapshots, number, lines and first status, and reads it back', async () => {
      const shirt = await variant();
      const cap = await variant();
      const cartId = await cart([
        { variantId: shirt, quantity: 2 },
        { variantId: cap, quantity: 1 },
      ]);

      const id = await run(() => checkout.placeOrder(guestOrder(cartId, 3)));

      const row = await prisma.order.findUniqueOrThrow({
        where: { id },
        include: {
          lines: { orderBy: { lineNumber: 'asc' } },
          statusHistory: true,
        },
      });
      const reservation = await prisma.reservation.findFirstOrThrow({
        where: { orderId: id },
      });
      expect(row).toMatchObject({
        status: 'PENDING_PAYMENT',
        customerId: null,
        contactEmail: 'cliente@example.com',
        currency: 'MXN',
        subtotal: 30_000,
        taxTotal: 4_138 + 1_366,
        shippingCost: 9_900,
        shippingTaxAmount: 1_366,
        shippingTaxRateBp: 1600,
        discountTotal: 0,
        grandTotal: 39_900,
        deliveryMinBusinessDays: 3,
        deliveryMaxBusinessDays: 7,
        reservationId: reservation.id,
        paymentDueAt: reservation.expiresAt,
        sourceCartId: cartId,
        privacyNoticeVersion: '2026-09',
        version: 1,
      });
      expect(row.shippingAddress).toEqual({
        ...ADDRESS,
        stateName: 'Michoacán de Ocampo',
        municipalityName: 'Morelia',
        country: 'MX',
      });
      expect(row.lines).toEqual([
        expect.objectContaining({
          lineNumber: 1,
          variantId: shirt,
          quantity: 2,
          unitPrice: 10_000,
          taxRateBp: 1600,
          taxAmount: 2_759,
          lineTotal: 20_000,
        }),
        expect.objectContaining({
          lineNumber: 2,
          variantId: cap,
          quantity: 1,
          taxAmount: 1_379,
          lineTotal: 10_000,
        }),
      ]);
      expect(row.statusHistory).toEqual([
        expect.objectContaining({
          fromStatus: null,
          toStatus: 'PENDING_PAYMENT',
          actorId: null,
          occurredAt: row.placedAt,
        }),
      ]);
      expect(row.createdAt).toEqual(row.placedAt);
      expect(
        (await prisma.cart.findUniqueOrThrow({ where: { id: cartId } })).status,
      ).toBe('CHECKED_OUT');

      const view = await queries.findOrder(id);
      expect(view).toMatchObject({
        id,
        publicCode: row.publicCode,
        itemCount: 3,
        paymentDueAt: reservation.expiresAt,
        totals: { grandTotal: Money.of(39_900, 'MXN') },
      });
      expect(view?.lines.map(({ lineNumber }) => lineNumber)).toEqual([1, 2]);
    });

    it('shows when payment is due only while the order is PENDING_PAYMENT', async () => {
      const shirt = await variant();
      const cartId = await cart([{ variantId: shirt, quantity: 1 }]);
      const id = await run(() => checkout.placeOrder(guestOrder(cartId, 1)));
      await prisma.order.update({ where: { id }, data: { status: 'PAID' } });

      const view = await queries.findOrder(id);

      expect(view?.status).toBe('PAID');
      expect(view?.paymentDueAt).toBeNull();
      expect(
        (await prisma.order.findUniqueOrThrow({ where: { id } })).paymentDueAt,
      ).not.toBeNull();
    });

    it('writes nothing for a public code that another order has, keeps the transaction usable (ADR-0049) and the IDs of the lines (ADR-0140)', async () => {
      const orders = moduleRef.get(OrderRepository);
      const transactions = moduleRef.get(TransactionManager);
      const taken = 'K7M4Q9XA' as PublicCode;
      const order = (id: OrderId, publicCode: PublicCode) =>
        Order.place({
          id,
          publicCode,
          buyer: {
            customerId: null,
            contactEmail: 'cliente@example.com',
            privacyNoticeVersion: '2026-09',
          },
          lines: [
            priceLine(
              {
                variantId: newId<'Variant'>(),
                sku: 'SKU-1',
                productName: 'Camisa',
                variantOptions: {},
                unitPrice: Money.of(10_000, 'MXN'),
                quantity: 1,
              },
              1600,
            ),
          ],
          shipping: {
            cost: Money.zero('MXN'),
            taxAmount: Money.zero('MXN'),
            taxRateBp: 1600,
            deliveryMinBusinessDays: 3,
            deliveryMaxBusinessDays: 7,
          },
          shippingAddress: {
            ...ADDRESS,
            stateName: 'Michoacán de Ocampo',
            municipalityName: 'Morelia',
            country: 'MX',
          },
          reservation: {
            id: newId<'Reservation'>(),
            expiresAt: new Date(START + 1_200_000),
          },
          sourceCartId: newId<'Cart'>(),
          now: new Date(START),
        });
      const [first, second] = [newId<'Order'>(), newId<'Order'>()];
      const kept = order(first, taken);

      const results = await run(() =>
        transactions.run(async () => [
          await orders.insert(kept),
          await orders.insert(order(second, taken)),
          await orders.insert(order(second, 'K7M4Q9XB' as PublicCode)),
        ]),
      );

      expect(results).toEqual([true, false, true]);
      const saved = await prisma.order.findMany({
        orderBy: { orderNumber: 'asc' },
        include: { lines: true, statusHistory: true },
      });
      expect(
        saved.map(({ id, publicCode, lines, statusHistory }) => [
          id,
          publicCode,
          lines.length,
          statusHistory.length,
        ]),
      ).toEqual([
        [first, taken, 1, 1],
        [second, 'K7M4Q9XB', 1, 1],
      ]);
      expect(saved[1].orderNumber).toBeGreaterThan(saved[0].orderNumber);
      expect(saved[0].lines.map(({ id }) => id)).toEqual(
        kept.snapshot.lines.map(({ id }) => id),
      );
    });

    it("lists a customer's orders by page, sorted by total with ties by ID, and finds only their own", async () => {
      const customer = await verifiedCustomer();
      const other = await verifiedCustomer();
      const codes: PublicCode[] = [];
      for (const [owner, units] of [
        [customer, 2],
        [customer, 1],
        [customer, 2],
        [other, 1],
      ] as const) {
        const shirt = await variant();
        await cart([{ variantId: shirt, quantity: units }], owner);
        const id = await run(() =>
          checkout.placeOrder({
            customerId: owner,
            shippingAddress: ADDRESS,
            expectedTotal: units * 10_000 + 9_900,
          }),
        );
        codes.push((await queries.findOrder(id))!.publicCode);
      }

      const page = await queries.listCustomerOrders(
        customer,
        {},
        [{ field: 'grandTotal', direction: 'desc' }],
        { page: 1, pageSize: 2 },
      );
      const rest = await queries.listCustomerOrders(
        customer,
        {},
        [{ field: 'grandTotal', direction: 'desc' }],
        { page: 2, pageSize: 2 },
      );

      expect(page.totalItems).toBe(3);
      // Equal totals: the earlier order has the lower UUIDv7.
      expect(
        [...page.items, ...rest.items].map(({ publicCode }) => publicCode),
      ).toEqual([codes[0], codes[2], codes[1]]);
      expect(page.items[0]).toMatchObject({
        itemCount: 2,
        customerId: customer,
      });
      expect(await queries.findCustomerOrder(customer, codes[3])).toBeNull();
      expect(
        (await queries.findCustomerOrder(customer, codes[1]))?.lines,
      ).toHaveLength(1);
      expect(parsePublicCode(codes[0])).toBe(codes[0]);
    });

    it("finds a guest order only with its code and its contact email, never a customer's (UC-ORD-04, ADR-0138)", async () => {
      const customer = await verifiedCustomer();
      const ids: OrderId[] = [];
      for (const owner of [null, customer, null]) {
        const cartId = await cart(
          [{ variantId: await variant(), quantity: 1 }],
          owner,
        );
        ids.push(
          await run(() =>
            checkout.placeOrder(
              owner === null
                ? guestOrder(cartId, 1)
                : {
                    customerId: owner,
                    shippingAddress: ADDRESS,
                    expectedTotal: 19_900,
                  },
            ),
          ),
        );
      }
      const [guest, ofCustomer, anonymized] = await Promise.all(
        ids.map(async (id) => (await queries.findOrder(id))!),
      );
      await prisma.order.update({
        where: { id: anonymized.id },
        data: { contactEmail: null, anonymizedAt: new Date(START) },
      });

      expect(
        (await queries.findGuestOrder(guest.publicCode, 'cliente@example.com'))
          ?.id,
      ).toBe(guest.id);
      for (const [code, email] of [
        [guest.publicCode, 'otro@example.com'],
        [guest.publicCode, 'Cliente@example.com'],
        [ofCustomer.publicCode, `${customer}@example.com`],
        [anonymized.publicCode, 'cliente@example.com'],
      ] as const) {
        expect(await queries.findGuestOrder(code, email)).toBeNull();
      }
    });
  });

  describe('orders at the same time', () => {
    it('waits for a change of the cart in progress, and orders what the cart holds after it (ADR-0131)', async () => {
      const shirt = await variant();
      const cartId = await cart([{ variantId: shirt, quantity: 2 }]);
      const client = await holder();
      try {
        await client.query('SELECT 1 FROM carts WHERE id = $1 FOR UPDATE', [
          cartId,
        ]);
        const placement = run(() => checkout.placeOrder(guestOrder(cartId, 2)));
        await waitForLockWaiters(1);
        await client.query(
          'UPDATE cart_lines SET quantity = 3 WHERE cart_id = $1',
          [cartId],
        );
        await client.query('COMMIT');

        // The order reads the cart with 3 units, so the total accepted for 2 no longer holds.
        await expect(placement).rejects.toThrow(TotalMismatchError);
      } finally {
        await client.end();
      }
      expect(await prisma.order.count()).toBe(0);
      expect(await reserved(shirt)).toBe(0);
    });

    it('places a single order when the same cart is ordered twice at once', async () => {
      const shirt = await variant();
      const cartId = await cart([{ variantId: shirt, quantity: 2 }]);
      const client = await holder();
      try {
        await client.query('SELECT 1 FROM carts WHERE id = $1 FOR UPDATE', [
          cartId,
        ]);
        const placements = [1, 2].map(() =>
          run(() => checkout.placeOrder(guestOrder(cartId, 2))),
        );
        await waitForLockWaiters(2);
        await client.query('COMMIT');

        expect(outcomes(await Promise.allSettled(placements))).toEqual([
          'CartNotActiveError',
          'ok',
        ]);
      } finally {
        await client.end();
      }
      expect(await prisma.order.count()).toBe(1);
      expect(await reserved(shirt)).toBe(2);
    });

    it('gives the last unit to one cart only, and the other reserves nothing (BR-INV-02)', async () => {
      const last = await variant(1);
      const shirt = await variant();
      const carts = [
        await cart([
          { variantId: shirt, quantity: 1 },
          { variantId: last, quantity: 1 },
        ]),
        await cart([{ variantId: last, quantity: 1 }]),
      ];
      const client = await holder();
      try {
        await client.query(
          'SELECT 1 FROM stock_items WHERE variant_id = $1 FOR UPDATE',
          [last],
        );
        const placements = [
          run(() => checkout.placeOrder(guestOrder(carts[0], 2))),
          run(() => checkout.placeOrder(guestOrder(carts[1], 1))),
        ];
        await waitForLockWaiters(2);
        await client.query('COMMIT');

        expect(outcomes(await Promise.allSettled(placements))).toEqual([
          'InsufficientStockError',
          'ok',
        ]);
      } finally {
        await client.end();
      }
      expect(await reserved(last)).toBe(1);
      expect(await prisma.order.count()).toBe(1);
      const { sourceCartId } = await prisma.order.findFirstOrThrow();
      const loser = carts.find((id) => id !== sourceCartId)!;
      expect(
        (await prisma.cart.findUniqueOrThrow({ where: { id: loser } })).status,
      ).toBe('ACTIVE');
      // The cart that lost holds nothing back: its other line is free too.
      expect(await reserved(shirt)).toBe(sourceCartId === carts[0] ? 1 : 0);
    });

    it('places a single order when a customer orders twice at once', async () => {
      const shirt = await variant();
      const customer = await verifiedCustomer();
      const cartId = await cart([{ variantId: shirt, quantity: 2 }], customer);
      const client = await holder();
      try {
        await client.query('SELECT 1 FROM carts WHERE id = $1 FOR UPDATE', [
          cartId,
        ]);
        const placements = [1, 2].map(() =>
          run(() =>
            checkout.placeOrder({
              customerId: customer,
              shippingAddress: ADDRESS,
              expectedTotal: 29_900,
            }),
          ),
        );
        await waitForLockWaiters(2);
        await client.query('COMMIT');

        expect(outcomes(await Promise.allSettled(placements))).toEqual([
          'EmptyCartError',
          'ok',
        ]);
      } finally {
        await client.end();
      }
      expect(await prisma.order.count()).toBe(1);
      expect(await reserved(shirt)).toBe(2);
    });
  });
});
