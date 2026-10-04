import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
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
  Clock,
  Money,
  monthsBefore,
  newId,
  toId,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import { AuditModule } from '../../audit/index.js';
import { ShippingQueries } from '../../shipping/application/shipping.queries.js';
import { BlockedOrderData } from '../application/blocked-order-data.js';
import { OrderingFacade } from '../application/ordering.facade.js';
import { OrderingQueries } from '../application/ordering.queries.js';
import {
  PersonalDataRetention,
  RETENTION_REASON,
} from '../application/personal-data-retention.js';
import {
  Order,
  type OrderId,
  type OrderStatus,
  priceLine,
} from '../domain/order.js';
import { OrderRepository } from '../domain/order.repository.js';
import { newPublicCode, type PublicCode } from '../domain/public-code.js';
import { OrderingModule } from '../ordering.module.js';

/** The warehouse its migration creates (ADR-0127). */
const MAIN = '01a0f54d-639d-7173-a3ff-f510cd91429d';
const START = Date.parse('2027-10-31T09:00:00.000Z');
/** `months` calendar months before the run, as the retention counts them (ADR-0149). */
const ago = (months: number) => monthsBefore(new Date(START), months);
const PLACED = ago(80);

const ADDRESS = {
  recipientName: 'María López Hernández',
  phone: '4431234567',
  street: 'Av. Madero Poniente',
  exteriorNumber: '123',
  interiorNumber: '4B',
  neighborhood: 'Centro',
  postalCode: '58000',
  stateCode: '16',
  stateName: 'Michoacán de Ocampo',
  municipalityCode: '16053',
  municipalityName: 'Morelia',
  city: 'Morelia',
  references: 'Entre Galeana e Hidalgo',
  country: 'MX',
} as const;

/** What a blocked or anonymized order or shipment shows of its address (ADR-0067, ADR-0070). */
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

const AUDITED = [
  'orders.block',
  'orders.anonymize',
  'orders.read-blocked-data',
];

type Buyer = { customerId: string; email: string } | { guestEmail: string };

/** The retention cycle of the personal data of orders against PostgreSQL 18 (T-232, ADR-0070, ADR-0151). */
describe('Ordering: retention of personal data (T-232)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cls: ClsService;
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
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(() => {
    current = START;
  });

  afterEach(async () => {
    await moduleRef.get(DomainEventDispatcher).whenIdle();
    await prisma.auditLog.deleteMany({ where: { action: { in: AUDITED } } });
    await prisma.orderAccessToken.deleteMany();
    await prisma.shipmentItem.deleteMany();
    await prisma.shipment.deleteMany();
    await prisma.orderStatusHistory.deleteMany();
    await prisma.orderLine.deleteMany();
    await prisma.order.deleteMany();
  });

  const run = <T>(work: () => Promise<T>) => cls.run(work);
  const retain = () => run(() => moduleRef.get(PersonalDataRetention).run());
  const queries = () => moduleRef.get(OrderingQueries);

  const DATES: Partial<Record<OrderStatus, (at: Date) => object>> = {
    PAID: () => ({ paidAt: PLACED }),
    SHIPPED: () => ({ paidAt: PLACED, shippedAt: PLACED }),
    DELIVERED: (at) => ({ paidAt: PLACED, shippedAt: PLACED, deliveredAt: at }),
    EXPIRED: (at) => ({ expiredAt: at }),
  };

  /**
   * An order of one shirt that concluded at `concludedAt`, DELIVERED then unless `status` says otherwise, with its
   * shipment in `shipment` when given, and blocked at `blockedAt` when given.
   */
  async function order(
    buyer: Buyer,
    concludedAt: Date | null,
    options: {
      status?: OrderStatus;
      shipment?: 'DELIVERED' | 'RETURNED';
      blockedAt?: Date;
    } = {},
  ): Promise<{ id: OrderId; publicCode: PublicCode }> {
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
      reservation: { id: newId<'Reservation'>(), expiresAt: PLACED },
      sourceCartId: newId<'Cart'>(),
      now: PLACED,
    });
    await run(() =>
      moduleRef
        .get(TransactionManager)
        .run(() => moduleRef.get(OrderRepository).insert(placed)),
    );
    const { id, publicCode } = placed.snapshot;
    const status = options.status ?? 'DELIVERED';
    await prisma.order.update({
      where: { id },
      data: {
        status,
        ...DATES[status]?.(concludedAt ?? PLACED),
        concludedAt,
        blockedAt: options.blockedAt ?? null,
      },
    });
    if (options.shipment !== undefined) {
      const returned = options.shipment === 'RETURNED';
      await prisma.shipment.create({
        data: {
          id: newId(),
          orderId: id,
          orderCode: publicCode,
          warehouseId: MAIN,
          status: options.shipment,
          destination: ADDRESS,
          ownDelivery: true,
          dispatchedAt: PLACED,
          deliveredAt: returned ? null : concludedAt,
          failedAt: returned ? PLACED : null,
          returnedAt: returned ? concludedAt : null,
          blockedAt: options.blockedAt ?? null,
        },
      });
    }
    return { id, publicCode };
  }

  const audited = async () =>
    (
      await prisma.auditLog.findMany({
        where: { action: { in: AUDITED } },
        orderBy: [{ action: 'desc' }, { resourceId: 'asc' }],
      })
    ).map(({ action, actorType, actorId, resourceId, changes, reason }) => ({
      action,
      actorType,
      actorId,
      resourceId,
      changes,
      reason,
    }));

  it('blocks the orders that concluded 12 months ago, with their shipments, audited as the system; and none twice', async () => {
    const ana = newId();
    const due = await order({ guestEmail: 'invitado@example.com' }, ago(13), {
      shipment: 'DELIVERED',
    });
    const expired = await order(
      { customerId: ana, email: 'ana@example.com' },
      ago(12),
      {
        status: 'EXPIRED',
      },
    );
    const recent = await order(
      { customerId: ana, email: 'ana@example.com' },
      ago(11),
      {
        shipment: 'DELIVERED',
      },
    );
    const active = await order(
      { customerId: ana, email: 'ana@example.com' },
      null,
      {
        status: 'PAID',
      },
    );

    expect(await retain()).toEqual({ blocked: 2, anonymized: 0, failed: 0 });

    const now = new Date(START + 1_000);
    const rows = await prisma.order.findMany({
      select: {
        id: true,
        blockedAt: true,
        contactEmail: true,
        shippingAddress: true,
        anonymizedAt: true,
      },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    // Blocked, the data stays: it is only hidden.
    for (const { id } of [due, expired]) {
      expect(byId.get(id)).toMatchObject({
        blockedAt: now,
        shippingAddress: ADDRESS,
        anonymizedAt: null,
      });
    }
    expect(byId.get(due.id)?.contactEmail).toBe('invitado@example.com');
    for (const { id } of [recent, active]) {
      expect(byId.get(id)?.blockedAt).toBeNull();
    }
    expect(
      await prisma.shipment.findMany({
        select: { orderId: true, blockedAt: true, destination: true },
        orderBy: { orderId: 'asc' },
      }),
    ).toEqual(
      [
        { orderId: due.id, blockedAt: now, destination: ADDRESS },
        { orderId: recent.id, blockedAt: null, destination: ADDRESS },
      ].sort((a, b) => (a.orderId < b.orderId ? -1 : 1)),
    );
    expect(await audited()).toEqual(
      [due.id, expired.id].sort().map((id) => ({
        action: 'orders.block',
        actorType: 'SYSTEM',
        actorId: null,
        resourceId: id,
        changes: { blockedAt: { from: null, to: now.toISOString() } },
        reason: null,
      })),
    );

    expect(await retain()).toEqual({ blocked: 0, anonymized: 0, failed: 0 });
  });

  it('hides a blocked order from its buyer and from a search by email, and shows it to the staff without the data of its buyer', async () => {
    const ana = toId<'User'>(newId());
    const guest = 'invitado@example.com';
    const ofAna = await order(
      { customerId: ana, email: 'ana@example.com' },
      ago(13),
    );
    const ofGuest = await order({ guestEmail: guest }, ago(13), {
      shipment: 'DELIVERED',
    });
    await retain();

    const views = queries();
    expect(await views.findOrder(ofAna.id)).toBeNull();
    expect(await views.findCustomerOrder(ana, ofAna.publicCode)).toBeNull();
    expect(
      await views.listCustomerOrders(ana, {}, [], { page: 1, pageSize: 20 }),
    ).toEqual({ items: [], totalItems: 0 });
    expect(await views.findGuestOrder(ofGuest.publicCode, guest)).toBeNull();
    expect(await views.hasGuestOrders(guest)).toBe(false);
    expect(await views.listGuestOrders(guest, 20)).toEqual([]);
    for (const q of ['invitado@example', 'ana@']) {
      expect(
        await views.listOrders({ q }, [], { page: 1, pageSize: 20 }),
      ).toEqual({ items: [], totalItems: 0 });
    }
    // By its code the staff still finds it.
    const found = await views.listOrders({ q: ofGuest.publicCode }, [], {
      page: 1,
      pageSize: 20,
    });
    expect(found.items).toEqual([
      expect.objectContaining({
        id: ofGuest.id,
        contactEmail: null,
        shippingAddress: KEPT,
        blockedAt: new Date(START + 1_000),
        anonymizedAt: null,
      }),
    ]);
    expect(await views.findAdminOrder(ofAna.id)).toMatchObject({
      contactEmail: null,
      shippingAddress: KEPT,
      blockedAt: new Date(START + 1_000),
    });

    const shipment = await prisma.shipment.findFirstOrThrow({
      where: { orderId: ofGuest.id },
    });
    expect(
      await moduleRef
        .get(ShippingQueries)
        .findShipment(toId<'Shipment'>(shipment.id)),
    ).toMatchObject({
      destination: KEPT,
      blockedAt: new Date(START + 1_000),
    });
  });

  it('shows an order that is not blocked yet as it was, to its buyer and to the staff', async () => {
    const ana = toId<'User'>(newId());
    const { id, publicCode } = await order(
      { customerId: ana, email: 'ana@example.com' },
      ago(11),
    );

    await retain();

    expect(await queries().findCustomerOrder(ana, publicCode)).not.toBeNull();
    expect(await queries().findAdminOrder(id)).toMatchObject({
      contactEmail: 'ana@example.com',
      shippingAddress: ADDRESS,
      blockedAt: null,
    });
  });

  it('anonymizes the orders that concluded 72 months ago, with their shipments and the access links of a guest, audited with the reason of the cycle', async () => {
    const guest = 'invitado@example.com';
    // Its shipment came back: the order stays SHIPPED, concluded (ADR-0145).
    const returned = await order({ guestEmail: guest }, ago(73), {
      status: 'SHIPPED',
      shipment: 'RETURNED',
      blockedAt: ago(61),
    });
    const ofCustomer = await order(
      { customerId: newId(), email: 'ana@example.com' },
      ago(72),
      { blockedAt: ago(60) },
    );
    const blocked = await order({ guestEmail: 'otro@example.com' }, ago(71), {
      blockedAt: ago(59),
    });
    const tokenOf = (contactEmail: string) => ({
      id: newId(),
      contactEmail,
      tokenHash: `hash-${newId()}`,
      expiresAt: new Date(START + 3_600_000),
    });
    await prisma.orderAccessToken.createMany({
      data: [
        tokenOf(guest),
        tokenOf('otro@example.com'),
        tokenOf('ana@example.com'),
      ],
    });

    expect(await retain()).toEqual({ blocked: 0, anonymized: 2, failed: 0 });

    const now = new Date(START + 1_000);
    for (const { id } of [returned, ofCustomer]) {
      expect(
        await prisma.order.findUniqueOrThrow({
          where: { id },
          select: {
            status: true,
            contactEmail: true,
            shippingAddress: true,
            anonymizedAt: true,
            blockedAt: true,
          },
        }),
      ).toMatchObject({
        contactEmail: null,
        shippingAddress: KEPT,
        anonymizedAt: now,
        // Anonymized, it stays blocked: when it was blocked is kept.
        blockedAt: id === returned.id ? ago(61) : ago(60),
      });
    }
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: returned.id } }))
        .status,
    ).toBe('SHIPPED');
    expect(
      await prisma.order.findUniqueOrThrow({
        where: { id: blocked.id },
        select: { contactEmail: true, anonymizedAt: true },
      }),
    ).toEqual({ contactEmail: 'otro@example.com', anonymizedAt: null });
    expect(
      await prisma.shipment.findFirstOrThrow({
        where: { orderId: returned.id },
        select: {
          status: true,
          destination: true,
          anonymizedAt: true,
          blockedAt: true,
        },
      }),
    ).toEqual({
      status: 'RETURNED',
      destination: KEPT,
      anonymizedAt: now,
      blockedAt: ago(61),
    });
    expect(
      (
        await prisma.orderAccessToken.findMany({
          select: { contactEmail: true },
          orderBy: { contactEmail: 'asc' },
        })
      ).map(({ contactEmail }) => contactEmail),
    ).toEqual(['ana@example.com', 'otro@example.com']);
    expect(await audited()).toEqual(
      [returned.id, ofCustomer.id].sort().map((id) => ({
        action: 'orders.anonymize',
        actorType: 'SYSTEM',
        actorId: null,
        resourceId: id,
        changes: {
          contactEmail: { changed: true },
          shippingAddress: { changed: true },
        },
        reason: RETENTION_REASON,
      })),
    );
  });

  it('answers the orders due by a date, the oldest first and up to a limit, never an anonymized one nor, to block, a blocked one', async () => {
    const guest = { guestEmail: 'invitado@example.com' };
    const oldest = await order(guest, ago(30));
    const older = await order(guest, ago(20));
    const blocked = await order(guest, ago(25), { blockedAt: ago(13) });
    await order(guest, ago(11));
    await order(guest, null, { status: 'PAID' });
    const anonymized = await order(guest, ago(40));
    await prisma.order.update({
      where: { id: anonymized.id },
      data: { anonymizedAt: ago(1), contactEmail: null },
    });
    const orders = moduleRef.get(OrderRepository);

    expect(await orders.dueForBlocking(ago(12), 1_000)).toEqual([
      oldest.id,
      older.id,
    ]);
    expect(await orders.dueForBlocking(ago(12), 1)).toEqual([oldest.id]);
    // Due on the cutoff itself.
    expect(await orders.dueForBlocking(ago(20), 1_000)).toEqual([
      oldest.id,
      older.id,
    ]);
    expect(await orders.dueForAnonymization(ago(12), 1_000)).toEqual([
      oldest.id,
      blocked.id,
      older.id,
    ]);
    expect(await orders.dueForAnonymization(ago(25), 1_000)).toEqual([
      oldest.id,
      blocked.id,
    ]);
    expect(await orders.dueForAnonymization(ago(12), 2)).toEqual([
      oldest.id,
      blocked.id,
    ]);
  });

  it('reads the data of a blocked order as saved, with the destination of its shipment, audited with the reason and without them (ADR-0152)', async () => {
    const { id } = await order(
      { guestEmail: 'invitado@example.com' },
      ago(13),
      {
        shipment: 'DELIVERED',
      },
    );
    const destination = { ...ADDRESS, street: 'Morelos Sur' };
    await prisma.shipment.updateMany({
      where: { orderId: id },
      data: { destination },
    });
    await retain();

    expect(
      await run(() =>
        moduleRef
          .get(BlockedOrderData)
          .read({ orderId: id, reason: 'Reclamación 2027-0153' }),
      ),
    ).toEqual({
      contactEmail: 'invitado@example.com',
      shippingAddress: ADDRESS,
      shipmentDestination: destination,
    });
    expect(
      await prisma.auditLog.findMany({
        where: { action: 'orders.read-blocked-data' },
        select: {
          resourceType: true,
          resourceId: true,
          changes: true,
          reason: true,
        },
      }),
    ).toEqual([
      {
        resourceType: 'order',
        resourceId: id,
        changes: null,
        reason: 'Reclamación 2027-0153',
      },
    ]);
  });

  it('reads no destination for a blocked order without a shipment', async () => {
    const { id } = await order({ guestEmail: 'invitado@example.com' }, ago(13));
    await retain();

    expect(
      (
        await run(() =>
          moduleRef
            .get(BlockedOrderData)
            .read({ orderId: id, reason: 'Requerimiento 15/2027' }),
        )
      ).shipmentDestination,
    ).toBeNull();
  });

  it('tells whether a customer has an order that has not concluded: on its way, or cancelled with its refund pending (ADR-0152)', async () => {
    const [paying, refunding, done] = [newId(), newId(), newId()];
    await order({ customerId: paying, email: 'ana@example.com' }, null, {
      status: 'PAID',
    });
    await order({ customerId: refunding, email: 'luis@example.com' }, null, {
      status: 'CANCELLED',
    });
    await order({ customerId: done, email: 'eva@example.com' }, ago(2));
    await order({ guestEmail: 'invitado@example.com' }, null, {
      status: 'PAID',
    });
    const ordering = moduleRef.get(OrderingFacade);

    expect(
      await Promise.all(
        [paying, refunding, done, newId()].map((id) =>
          ordering.hasOpenOrders(id),
        ),
      ),
    ).toEqual([true, true, false, false]);
  });

  it('refuses a blocked order that has not concluded', async () => {
    const { id } = await order({ guestEmail: 'invitado@example.com' }, null, {
      status: 'PAID',
    });

    await expect(
      prisma.order.update({ where: { id }, data: { blockedAt: ago(1) } }),
    ).rejects.toThrow(/orders_blocked_at_check/);
  });
});
