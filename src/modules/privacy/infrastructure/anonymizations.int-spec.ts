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
  NotFoundError,
  toId,
  TransactionManager,
  VersionConflictError,
} from '../../../shared-kernel/index.js';
import { AuditModule } from '../../audit/index.js';
import { Checkout } from '../../ordering/application/checkout.use-case.js';
import { OrderingQueries } from '../../ordering/application/ordering.queries.js';
import {
  Order,
  type OrderStatus,
  priceLine,
} from '../../ordering/domain/order.js';
import { OrderRepository } from '../../ordering/domain/order.repository.js';
import { ActiveOrdersExistError } from '../../ordering/domain/ordering-errors.js';
import {
  newPublicCode,
  type PublicCode,
} from '../../ordering/domain/public-code.js';
import { Anonymizations } from '../application/anonymizations.js';
import { PrivacyModule } from '../privacy.module.js';

/** The list and the warehouse their migrations create (ADR-0125, ADR-0127). */
const DEFAULT_LIST = '01a0f4f2-bb5f-770a-a269-105d21861fe0';
const MAIN = '01a0f54d-639d-7173-a3ff-f510cd91429d';
const START = Date.parse('2026-10-02T12:00:00.000Z');
const BEFORE = new Date(START - 3_600_000);

const ADDRESS_INPUT = {
  recipientName: 'María López Hernández',
  phone: '4431234567',
  street: 'Av. Madero Poniente',
  exteriorNumber: '123',
  interiorNumber: '4B',
  neighborhood: 'Centro',
  postalCode: '58000',
  stateCode: '16',
  municipalityCode: '16053',
  city: 'Morelia',
  references: 'Entre Galeana e Hidalgo',
};

const ADDRESS = {
  ...ADDRESS_INPUT,
  stateName: 'Michoacán de Ocampo',
  municipalityName: 'Morelia',
  country: 'MX',
} as const;

/** What an anonymized order or shipment keeps of its address (ADR-0067). */
const KEPT = {
  recipientName: null,
  phone: null,
  street: null,
  exteriorNumber: null,
  interiorNumber: null,
  neighborhood: null,
  postalCode: '58000',
  stateCode: '16',
  stateName: 'Michoacán de Ocampo',
  municipalityCode: '16053',
  municipalityName: 'Morelia',
  city: null,
  references: null,
  country: 'MX',
};

const AUDITED = ['customers.anonymize', 'orders.anonymize'];

/**
 * The anonymizations of Privacy against PostgreSQL 18, across Identity & Access, Ordering, Shipping and Shopping
 * (T-132, ADR-0067, ADR-0145), and how they line up with a checkout of the same customer.
 */
describe('Privacy: anonymizations (T-132)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cls: ClsService;
  let anonymizations: Anonymizations;
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
        PrivacyModule,
      ],
    })
      .overrideProvider(Clock)
      .useValue(clock)
      .compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    cls = moduleRef.get(ClsService);
    anonymizations = moduleRef.get(Anonymizations);
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
    await prisma.auditLog.deleteMany({ where: { action: { in: AUDITED } } });
    await prisma.shipmentItem.deleteMany();
    await prisma.shipment.deleteMany();
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
    await prisma.idempotencyKey.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.emailVerificationToken.deleteMany();
    await prisma.passwordResetToken.deleteMany();
    await prisma.customerAddress.deleteMany();
    await prisma.user.deleteMany();
  });

  const run = <T>(work: () => Promise<T>) => cls.run(work);

  /** A verified customer, with a session, a pending verification and recovery link, and a saved address. */
  async function customer(email?: string): Promise<string> {
    const id = newId();
    await prisma.user.create({
      data: {
        id,
        type: 'CUSTOMER',
        email: email ?? `${id}@example.com`,
        firstNames: 'Ana',
        lastNames: 'Pérez',
        passwordHash: 'not-a-real-hash',
        emailVerifiedAt: BEFORE,
        privacyNoticeVersion: '2026-09',
      },
    });
    const expiresAt = new Date(START + 86_400_000);
    await prisma.refreshToken.create({
      data: {
        id: newId(),
        userId: id,
        sessionId: newId(),
        tokenHash: `refresh-${id}`,
        expiresAt,
      },
    });
    await prisma.emailVerificationToken.create({
      data: {
        id: newId(),
        userId: id,
        email: `nuevo-${id}@example.com`,
        tokenHash: `verification-${id}`,
        expiresAt,
      },
    });
    await prisma.passwordResetToken.create({
      data: {
        id: newId(),
        userId: id,
        tokenHash: `reset-${id}`,
        expiresAt,
      },
    });
    await prisma.customerAddress.create({
      data: { id: newId(), userId: id, ...ADDRESS_INPUT, isDefault: true },
    });
    return id;
  }

  /** A cart of one shirt, of a customer or of a guest, merged into another cart when given. */
  async function cart(
    owner: string | null,
    status: 'ACTIVE' | 'CHECKED_OUT' | 'MERGED' = 'ACTIVE',
    mergedIntoCartId: string | null = null,
    variantId: string = newId(),
  ): Promise<string> {
    const id = newId();
    await prisma.cart.create({
      data: {
        id,
        ownerUserId: owner,
        status,
        mergedIntoCartId,
        lastActivityAt: BEFORE,
        lines: { create: [{ variantId, quantity: 1 }] },
      },
    });
    return id;
  }

  const DATES: Partial<Record<OrderStatus, object>> = {
    PAID: { paidAt: BEFORE },
    SHIPPED: { paidAt: BEFORE, shippedAt: BEFORE },
    DELIVERED: { paidAt: BEFORE, shippedAt: BEFORE, deliveredAt: BEFORE },
    CANCELLED: { cancelledAt: BEFORE },
    EXPIRED: { expiredAt: BEFORE },
  };

  /** An order of one shirt, $199.00 with shipping, in `status`, with its shipment in `shipment` when given. */
  async function order(
    buyer: { customerId: string; email: string } | { guestEmail: string },
    status: OrderStatus,
    shipment?: 'DELIVERED' | 'RETURNED',
  ): Promise<{ id: string; publicCode: string }> {
    const placed = Order.place({
      id: newId<'Order'>(),
      publicCode: newPublicCode(),
      buyer:
        'customerId' in buyer
          ? {
              customerId: toId<'User'>(buyer.customerId),
              contactEmail: buyer.email,
            }
          : {
              customerId: null,
              contactEmail: buyer.guestEmail,
              privacyNoticeVersion: '2026-09',
            },
      lines: [
        priceLine(
          {
            variantId: newId<'Variant'>(),
            sku: 'CAM-M',
            productName: 'Camisa de lino',
            variantOptions: { talla: 'M' },
            unitPrice: Money.of(10_000, 'MXN'),
            quantity: 1,
          },
          1600,
        ),
      ],
      shipping: {
        cost: Money.of(9_900, 'MXN'),
        taxAmount: Money.of(1_366, 'MXN'),
        taxRateBp: 1600,
        deliveryMinBusinessDays: 3,
        deliveryMaxBusinessDays: 7,
      },
      shippingAddress: ADDRESS,
      reservation: { id: newId<'Reservation'>(), expiresAt: BEFORE },
      sourceCartId: newId<'Cart'>(),
      now: new Date(START - 86_400_000),
    });
    await run(() =>
      moduleRef
        .get(TransactionManager)
        .run(() => moduleRef.get(OrderRepository).insert(placed)),
    );
    const { id, publicCode } = placed.snapshot;
    await prisma.order.update({
      where: { id },
      data: { status, ...DATES[status] },
    });
    if (shipment !== undefined) {
      await prisma.shipment.create({
        data: {
          id: newId(),
          orderId: id,
          orderCode: publicCode,
          warehouseId: MAIN,
          status: shipment,
          destination: ADDRESS,
          ownDelivery: true,
          dispatchedAt: BEFORE,
          deliveredAt: shipment === 'DELIVERED' ? BEFORE : null,
          failedAt: shipment === 'RETURNED' ? BEFORE : null,
          returnedAt: shipment === 'RETURNED' ? BEFORE : null,
        },
      });
    }
    return { id, publicCode };
  }

  const anonymizeCustomer = (userId: string, version = 1) =>
    run(() =>
      anonymizations.customer({
        actorId: newId(),
        userId,
        reason: 'ARCO-2026-0042',
        version,
      }),
    );

  /** Another connection, in a transaction, to hold a lock while a test lines up what waits for it. */
  async function holder(): Promise<pg.Client> {
    const client = new pg.Client({
      connectionString: process.env.DATABASE_URL,
    });
    await client.connect();
    await client.query('BEGIN');
    return client;
  }

  const anonymizeGuest = (contactEmail: string, publicCode: string) =>
    run(() =>
      anonymizations.guest({
        contactEmail,
        publicCode,
        reason: 'ARCO-2026-0043',
      }),
    );

  /** What each customer still has in Identity & Access and Shopping. */
  const tracesOf = async (userId: string) => ({
    refreshTokens: await prisma.refreshToken.count({ where: { userId } }),
    verificationTokens: await prisma.emailVerificationToken.count({
      where: { userId },
    }),
    resetTokens: await prisma.passwordResetToken.count({ where: { userId } }),
    addresses: await prisma.customerAddress.count({ where: { userId } }),
    carts: await prisma.cart.count({ where: { ownerUserId: userId } }),
  });

  /** A response kept for the idempotency of a request in a scope, completed or still in progress. */
  async function keptResponse(
    scopeType: 'USER' | 'CART',
    scopeId: string,
    status: 'COMPLETED' | 'IN_PROGRESS' = 'COMPLETED',
  ): Promise<void> {
    await prisma.idempotencyKey.create({
      data: {
        scopeType,
        scopeId,
        endpoint: 'POST /v1/orders',
        key: newId(),
        requestHash: 'hash',
        status,
        responseStatus: status === 'COMPLETED' ? 201 : null,
        responseBody:
          status === 'COMPLETED'
            ? { kind: 'success', status: 201, body: { contactEmail: 'x' } }
            : undefined,
        expiresAt: new Date(START + 86_400_000),
      },
    });
  }

  /** How many responses are still kept in a scope. */
  const keptIn = (scopeId: string) =>
    prisma.idempotencyKey.count({ where: { scopeId } });

  /** The order as if the staff placed it in the store (ADR-0161): without a cart, by `staffId`, from MAIN. */
  const placedInStore = (orderId: string, staffId: string) =>
    prisma.order.update({
      where: { id: orderId },
      data: {
        channel: 'STORE',
        sourceCartId: null,
        placedBy: staffId,
        warehouseId: MAIN,
      },
    });

  /** A response kept in the scope of a staff member, of an endpoint, about a resource. */
  async function keptStaffResponse(
    staffId: string,
    resourceId: string,
    endpoint = 'POST /v1/admin/orders',
    status: 'COMPLETED' | 'IN_PROGRESS' = 'COMPLETED',
  ): Promise<string> {
    const key = newId();
    await prisma.idempotencyKey.create({
      data: {
        scopeType: 'USER',
        scopeId: staffId,
        endpoint,
        key,
        requestHash: 'hash',
        status,
        responseStatus: status === 'COMPLETED' ? 201 : null,
        responseBody:
          status === 'COMPLETED'
            ? {
                kind: 'success',
                status: 201,
                body: { id: resourceId, contactEmail: 'x' },
              }
            : undefined,
        expiresAt: new Date(START + 86_400_000),
      },
    });
    return key;
  }

  /** The keys still kept in the scope of a staff member. */
  const staffKeys = async (staffId: string) =>
    (
      await prisma.idempotencyKey.findMany({
        where: { scopeId: staffId },
        select: { key: true },
      })
    )
      .map(({ key }) => key)
      .sort();

  const ordersOf = (ids: string[]) =>
    prisma.order.findMany({
      where: { id: { in: ids } },
      include: { lines: true },
      orderBy: { id: 'asc' },
    });

  describe('a customer (UC-IAM-19)', () => {
    it('anonymizes the account, the orders and their shipments, and deletes the sessions, links, addresses and carts, in one go', async () => {
      const ana = await customer();
      const other = await customer();
      const email = `${ana}@example.com`;
      const delivered = await order(
        { customerId: ana, email },
        'DELIVERED',
        'DELIVERED',
      );
      const returned = await order(
        { customerId: ana, email },
        'SHIPPED',
        'RETURNED',
      );
      const expired = await order({ customerId: ana, email }, 'EXPIRED');
      const othersOrder = await order(
        { customerId: other, email: `${other}@example.com` },
        'DELIVERED',
        'DELIVERED',
      );
      const active = await cart(ana);
      await cart(ana, 'CHECKED_OUT');
      const merged = await cart(null, 'MERGED', active);
      const othersCart = await cart(other);
      const guestCart = await cart(null);
      const before = await ordersOf([delivered.id, returned.id, expired.id]);
      await keptResponse('USER', ana);
      await keptResponse('USER', ana);
      await keptResponse('USER', other);

      const done = await anonymizeCustomer(ana);

      const at = new Date(START + 1_000);
      expect(done).toEqual({
        userId: ana,
        anonymizedAt: at,
        anonymizedOrderCount: 3,
      });
      expect(
        await prisma.user.findUniqueOrThrow({ where: { id: ana } }),
      ).toMatchObject({
        status: 'ANONYMIZED',
        email: null,
        firstNames: null,
        lastNames: null,
        passwordHash: null,
        emailVerifiedAt: null,
        anonymizedAt: at,
        privacyNoticeVersion: '2026-09',
        version: 2,
      });
      expect(await tracesOf(ana)).toEqual({
        refreshTokens: 0,
        verificationTokens: 0,
        resetTokens: 0,
        addresses: 0,
        carts: 0,
      });
      expect(
        await prisma.cart.findUnique({ where: { id: merged } }),
      ).toBeNull();
      expect(await prisma.cartLine.count({ where: { cartId: active } })).toBe(
        0,
      );
      // Nothing of anybody else changes.
      expect(await tracesOf(other)).toEqual({
        refreshTokens: 1,
        verificationTokens: 1,
        resetTokens: 1,
        addresses: 1,
        carts: 1,
      });
      expect(
        await prisma.cart.count({
          where: { id: { in: [othersCart, guestCart] } },
        }),
      ).toBe(2);
      expect([await keptIn(ana), await keptIn(other)]).toEqual([0, 1]);
      expect(
        await prisma.order.findUniqueOrThrow({ where: { id: othersOrder.id } }),
      ).toMatchObject({
        contactEmail: `${other}@example.com`,
        anonymizedAt: null,
      });

      const after = await ordersOf([delivered.id, returned.id, expired.id]);
      expect(after).toEqual(
        before.map((row) => ({
          ...row,
          contactEmail: null,
          shippingAddress: KEPT,
          anonymizedAt: at,
          version: row.version + 1,
          updatedAt: at,
        })),
      );
      const shipments = await prisma.shipment.findMany({
        where: { orderId: { in: [delivered.id, returned.id] } },
      });
      expect(
        shipments.map(({ destination, anonymizedAt, status, version }) => ({
          destination,
          anonymizedAt,
          status,
          version,
        })),
      ).toEqual([
        {
          destination: KEPT,
          anonymizedAt: at,
          status: expect.any(String),
          version: 2,
        },
        {
          destination: KEPT,
          anonymizedAt: at,
          status: expect.any(String),
          version: 2,
        },
      ]);
      expect(
        (
          await prisma.shipment.findUniqueOrThrow({
            where: { orderId: othersOrder.id },
          })
        ).anonymizedAt,
      ).toBeNull();

      const audited = await prisma.auditLog.findMany({
        where: { action: { in: AUDITED } },
        orderBy: [{ action: 'asc' }, { resourceId: 'asc' }],
      });
      expect(
        audited.map(
          ({ action, resourceType, resourceId, changes, reason }) => ({
            action,
            resourceType,
            resourceId,
            changes,
            reason,
          }),
        ),
      ).toEqual([
        {
          action: 'customers.anonymize',
          resourceType: 'user',
          resourceId: ana,
          changes: {
            status: { from: 'ACTIVE', to: 'ANONYMIZED' },
            email: { changed: true },
            firstNames: { changed: true },
            lastNames: { changed: true },
            passwordHash: { changed: true },
          },
          reason: 'ARCO-2026-0042',
        },
        ...[delivered.id, returned.id, expired.id].sort().map((id) => ({
          action: 'orders.anonymize',
          resourceType: 'order',
          resourceId: id,
          changes: {
            contactEmail: { changed: true },
            shippingAddress: { changed: true },
          },
          reason: 'ARCO-2026-0042',
        })),
      ]);
    });

    it('forgets the response the staff kept of an order it placed in the store for the customer (ADR-0161)', async () => {
      const ana = await customer('ana.tienda@example.com');
      const staff = newId();
      const inStore = await order(
        { customerId: ana, email: 'ana.tienda@example.com' },
        'DELIVERED',
      );
      await placedInStore(inStore.id, staff);
      await keptStaffResponse(staff, inStore.id);
      const other = await keptStaffResponse(staff, newId());

      await anonymizeCustomer(ana);

      expect(await staffKeys(staff)).toEqual([other]);
    });

    it('leaves alone an order anonymized before, as the retention cycle will (T-232)', async () => {
      const ana = await customer();
      const email = `${ana}@example.com`;
      const earlier = await order({ customerId: ana, email }, 'DELIVERED');
      await order({ customerId: ana, email }, 'EXPIRED');
      const before = new Date(START - 60_000);
      await prisma.order.update({
        where: { id: earlier.id },
        data: {
          contactEmail: null,
          shippingAddress: KEPT,
          anonymizedAt: before,
        },
      });

      expect((await anonymizeCustomer(ana)).anonymizedOrderCount).toBe(1);
      expect(
        await prisma.order.findUniqueOrThrow({ where: { id: earlier.id } }),
      ).toMatchObject({ anonymizedAt: before, version: 1 });
    });

    it("waits for a change of the customer's cart in progress, and deletes the cart it leaves (ADR-0131)", async () => {
      const ana = await customer();
      const client = await holder();
      try {
        // A change of a customer's cart takes the lock of their carts first.
        await client.query(
          'SELECT pg_advisory_xact_lock($1::int, hashtext($2::text))',
          [0x43415254, ana],
        );
        await client.query(
          `INSERT INTO carts (id, owner_user_id, status, last_activity_at, created_at, updated_at)
           VALUES ($1, $2, 'ACTIVE', now(), now(), now())`,
          [newId(), ana],
        );
        const anonymizing = anonymizeCustomer(ana);
        await waitForLockWaiters(1);
        await client.query('COMMIT');
        await anonymizing;
      } finally {
        await client.end();
      }

      expect(await prisma.cart.count({ where: { ownerUserId: ana } })).toBe(0);
    });

    it('frees the email for a new account', async () => {
      const ana = await customer('ana@example.com');
      await anonymizeCustomer(ana);

      await expect(customer('ana@example.com')).resolves.toEqual(
        expect.any(String),
      );
    });

    it('shows the staff an anonymized order without its buyer, and never shows it to the customer', async () => {
      const ana = await customer();
      const delivered = await order(
        { customerId: ana, email: `${ana}@example.com` },
        'DELIVERED',
      );
      await anonymizeCustomer(ana);
      const queries = moduleRef.get(OrderingQueries);
      const id = toId<'Order'>(delivered.id);

      expect(await queries.findAdminOrder(id)).toMatchObject({
        contactEmail: null,
        shippingAddress: KEPT,
        anonymizedAt: new Date(START + 1_000),
      });
      expect(await queries.findOrder(id)).toBeNull();
      expect(
        await queries.findCustomerOrder(
          toId<'User'>(ana),
          delivered.publicCode as PublicCode,
        ),
      ).toBeNull();
      expect(
        await queries.listCustomerOrders(toId<'User'>(ana), {}, [], {
          page: 1,
          pageSize: 20,
        }),
      ).toEqual({ items: [], totalItems: 0 });
    });

    it('anonymizes nothing while an order has not concluded: one on its way, or cancelled with its refund pending (E-31)', async () => {
      for (const [status, paid] of [
        ['PENDING_PAYMENT', false],
        ['PAID', true],
        ['AWAITING_MANUAL_FULFILLMENT', true],
        ['SHIPPED', true],
        ['CANCELLED', true],
      ] as const) {
        const ana = await customer();
        const email = `${ana}@example.com`;
        const delivered = await order(
          { customerId: ana, email },
          'DELIVERED',
          'DELIVERED',
        );
        const open = await order(
          { customerId: ana, email },
          status,
          status === 'SHIPPED' ? 'DELIVERED' : undefined,
        );
        if (paid) {
          await prisma.order.update({
            where: { id: open.id },
            data: { paidAt: BEFORE },
          });
        }
        await cart(ana);

        await expect(anonymizeCustomer(ana)).rejects.toThrow(
          ActiveOrdersExistError,
        );

        expect(
          await prisma.user.findUniqueOrThrow({ where: { id: ana } }),
        ).toMatchObject({
          status: 'ACTIVE',
          email,
          version: 1,
        });
        expect(await tracesOf(ana)).toEqual({
          refreshTokens: 1,
          verificationTokens: 1,
          resetTokens: 1,
          addresses: 1,
          carts: 1,
        });
        expect(
          (await ordersOf([delivered.id, open.id])).map(
            ({ contactEmail, anonymizedAt }) => ({
              contactEmail,
              anonymizedAt,
            }),
          ),
        ).toEqual([
          { contactEmail: email, anonymizedAt: null },
          { contactEmail: email, anonymizedAt: null },
        ]);
      }
      expect(
        await prisma.auditLog.count({ where: { action: { in: AUDITED } } }),
      ).toBe(0);
    });

    it('checks the customer, the version and that it was not anonymized, in this order', async () => {
      const ana = await customer();
      await order({ customerId: ana, email: `${ana}@example.com` }, 'PAID');
      const staff = newId();
      await prisma.user.create({
        data: {
          id: staff,
          type: 'STAFF',
          email: `${staff}@example.com`,
          firstNames: 'Luis',
          lastNames: 'Gómez',
          passwordHash: 'not-a-real-hash',
        },
      });

      await expect(anonymizeCustomer(staff)).rejects.toThrow(NotFoundError);
      await expect(anonymizeCustomer(newId())).rejects.toThrow(NotFoundError);
      await expect(anonymizeCustomer(ana, 2)).rejects.toThrow(
        VersionConflictError,
      );
      await prisma.order.updateMany({
        where: { customerId: ana },
        data: { status: 'EXPIRED' },
      });
      await anonymizeCustomer(ana);
      await expect(anonymizeCustomer(ana, 2)).rejects.toThrow(
        new InvalidStateTransitionError('ANONYMIZED', 'anonymize'),
      );
    });
  });

  describe('a guest buyer (UC-IAM-19)', () => {
    it("anonymizes every guest order with the email and their shipments, never a customer's with the same email", async () => {
      const email = 'invitada@example.com';
      const first = await order(
        { guestEmail: email },
        'DELIVERED',
        'DELIVERED',
      );
      const second = await order({ guestEmail: email }, 'EXPIRED');
      const anotherGuest = await order(
        { guestEmail: 'otra@example.com' },
        'DELIVERED',
      );
      const ana = await customer(email);
      const customers = await order({ customerId: ana, email }, 'DELIVERED');
      const cartsOf = async (...ids: string[]) =>
        (
          await prisma.order.findMany({
            where: { id: { in: ids } },
            select: { id: true, sourceCartId: true },
          })
        )
          .sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))
          .map(({ sourceCartId }) => sourceCartId as string);
      const [firstCart, secondCart, anotherCart] = await cartsOf(
        first.id,
        second.id,
        anotherGuest.id,
      );
      await keptResponse('CART', firstCart);
      await keptResponse('CART', secondCart);
      await keptResponse('CART', secondCart, 'IN_PROGRESS');
      await keptResponse('CART', anotherCart);
      await keptResponse('USER', ana);

      expect(
        await anonymizeGuest(
          ' Invitada@Example.com ',
          second.publicCode.toLowerCase(),
        ),
      ).toBe(2);

      const rows = await prisma.order.findMany({
        where: {
          id: { in: [first.id, second.id, anotherGuest.id, customers.id] },
        },
      });
      const byId = new Map(rows.map((row) => [row.id, row]));
      for (const anonymized of [first, second]) {
        expect(byId.get(anonymized.id)).toMatchObject({
          contactEmail: null,
          shippingAddress: KEPT,
          anonymizedAt: new Date(START + 1_000),
        });
      }
      expect(byId.get(anotherGuest.id)).toMatchObject({
        contactEmail: 'otra@example.com',
        anonymizedAt: null,
      });
      expect(byId.get(customers.id)).toMatchObject({
        contactEmail: email,
        anonymizedAt: null,
      });
      expect(
        await prisma.shipment.findUniqueOrThrow({
          where: { orderId: first.id },
        }),
      ).toMatchObject({
        destination: KEPT,
        anonymizedAt: new Date(START + 1_000),
      });
      expect(
        await prisma.user.findUniqueOrThrow({ where: { id: ana } }),
      ).toMatchObject({ status: 'ACTIVE', email });
      // A request still in progress keeps no response yet.
      expect([
        await keptIn(firstCart),
        await keptIn(secondCart),
        await keptIn(anotherCart),
        await keptIn(ana),
      ]).toEqual([0, 1, 1, 1]);
      expect(
        await prisma.auditLog.count({
          where: { action: 'orders.anonymize', reason: 'ARCO-2026-0043' },
        }),
      ).toBe(2);
    });

    it('anonymizes a guest order the staff placed in the store, without a cart, and forgets only its response in the scope of the staff (ADR-0161)', async () => {
      const email = 'tienda@example.com';
      const staff = newId();
      const inStore = await order({ guestEmail: email }, 'DELIVERED');
      const another = await order(
        { guestEmail: 'otra@example.com' },
        'DELIVERED',
      );
      await placedInStore(inStore.id, staff);
      await placedInStore(another.id, staff);
      await keptStaffResponse(staff, inStore.id);
      const kept = [
        await keptStaffResponse(staff, another.id),
        await keptStaffResponse(
          staff,
          inStore.id,
          'POST /v1/admin/orders/:orderId/restocks',
        ),
        await keptStaffResponse(
          staff,
          inStore.id,
          'POST /v1/admin/orders',
          'IN_PROGRESS',
        ),
      ].sort();

      expect(await anonymizeGuest(email, inStore.publicCode)).toBe(1);

      expect(
        await prisma.order.findUniqueOrThrow({ where: { id: inStore.id } }),
      ).toMatchObject({ contactEmail: null, shippingAddress: KEPT });
      expect(await staffKeys(staff)).toEqual(kept);
    });

    it("answers the same 404 for a code of another email, a customer's order, a code that cannot exist, and once anonymized", async () => {
      const email = 'invitada@example.com';
      const guestOrder = await order({ guestEmail: email }, 'DELIVERED');
      const another = await order(
        { guestEmail: 'otra@example.com' },
        'DELIVERED',
      );
      const ana = await customer(email);
      const customers = await order({ customerId: ana, email }, 'DELIVERED');

      for (const code of [
        another.publicCode,
        customers.publicCode,
        'not a code',
      ]) {
        await expect(anonymizeGuest(email, code)).rejects.toThrow(
          NotFoundError,
        );
      }
      expect(
        await prisma.order.count({ where: { anonymizedAt: { not: null } } }),
      ).toBe(0);

      await anonymizeGuest(email, guestOrder.publicCode);
      await expect(
        anonymizeGuest(email, guestOrder.publicCode),
      ).rejects.toThrow(NotFoundError);
    });

    it('anonymizes no guest order while one has not concluded (E-31)', async () => {
      const email = 'invitada@example.com';
      const delivered = await order({ guestEmail: email }, 'DELIVERED');
      await order({ guestEmail: email }, 'PAID');

      await expect(anonymizeGuest(email, delivered.publicCode)).rejects.toThrow(
        ActiveOrdersExistError,
      );
      expect(await prisma.order.count({ where: { contactEmail: email } })).toBe(
        2,
      );
    });
  });

  describe('a checkout of the same customer at once (ADR-0145)', () => {
    /** A published variant priced at $100.00, with `stock` units. */
    async function variant(stock = 5): Promise<string> {
      const productId = newId();
      const id = newId();
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

    const placeOrder = (customerId: string) =>
      run(() =>
        moduleRef.get(Checkout).placeOrder({
          customerId: toId<'User'>(customerId),
          shippingAddress: ADDRESS_INPUT,
          expectedTotal: 19_900,
        }),
      );

    /** Why each operation ended: `ok`, or the name of the error it threw. */
    const outcome = (result: PromiseSettledResult<unknown>) =>
      result.status === 'fulfilled'
        ? 'ok'
        : (result.reason as Error).constructor.name;

    it('waits for an order being placed, and then finds it unfinished', async () => {
      const ana = await customer();
      const active = await cart(ana, 'ACTIVE', null, await variant());
      const client = await holder();
      let results: PromiseSettledResult<unknown>[];
      try {
        // The checkout reads the customer, and then waits for the cart.
        await client.query('SELECT 1 FROM carts WHERE id = $1 FOR UPDATE', [
          active,
        ]);
        const placing = placeOrder(ana);
        await waitForLockWaiters(1);
        const anonymizing = anonymizeCustomer(ana);
        await waitForLockWaiters(2);
        await client.query('COMMIT');
        results = await Promise.allSettled([placing, anonymizing]);
      } finally {
        await client.end();
      }

      expect(results.map(outcome)).toEqual(['ok', 'ActiveOrdersExistError']);
      expect(
        await prisma.user.findUniqueOrThrow({ where: { id: ana } }),
      ).toMatchObject({ status: 'ACTIVE', email: `${ana}@example.com` });
      expect(
        await prisma.order.findFirstOrThrow({ where: { customerId: ana } }),
      ).toMatchObject({
        status: 'PENDING_PAYMENT',
        contactEmail: `${ana}@example.com`,
      });
    });

    it('makes an order being placed wait, and then the customer is no longer there', async () => {
      const ana = await customer();
      const shirt = await variant();
      await cart(ana, 'ACTIVE', null, shirt);
      const delivered = await order(
        { customerId: ana, email: `${ana}@example.com` },
        'DELIVERED',
      );
      const client = await holder();
      let results: PromiseSettledResult<unknown>[];
      try {
        // The anonymization changes the account, and then waits for the orders.
        await client.query('SELECT 1 FROM orders WHERE id = $1 FOR UPDATE', [
          delivered.id,
        ]);
        const anonymizing = anonymizeCustomer(ana);
        await waitForLockWaiters(1);
        const placing = placeOrder(ana);
        await waitForLockWaiters(2);
        await client.query('COMMIT');
        results = await Promise.allSettled([anonymizing, placing]);
      } finally {
        await client.end();
      }

      expect(results.map(outcome)).toEqual(['ok', 'NotFoundError']);
      expect(await prisma.order.count({ where: { customerId: ana } })).toBe(1);
      expect(
        (
          await prisma.stockItem.findFirstOrThrow({
            where: { variantId: shirt },
          })
        ).reserved,
      ).toBe(0);
    });
  });
});
