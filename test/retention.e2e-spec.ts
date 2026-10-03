import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { PersonalDataRetention } from '../src/modules/ordering/application/personal-data-retention.js';
import type { AuthenticatedUser } from '../src/platform/auth/authenticated-user.js';
import { DomainEventDispatcher } from '../src/platform/events/domain-event-dispatcher.js';
import { configureHttp } from '../src/platform/http/configure-http.js';
import { PrismaService } from '../src/platform/persistence/prisma.service.js';
import {
  monthsBefore,
  newId,
  type PermissionCode,
} from '../src/shared-kernel/index.js';
import {
  signedInAs,
  useTestAuthentication,
} from './support/test-authentication.js';

/** The list and the warehouse their migrations create (ADR-0125, ADR-0127). */
const DEFAULT_LIST = '01a0f4f2-bb5f-770a-a269-105d21861fe0';
const MAIN = '01a0f54d-639d-7173-a3ff-f510cd91429d';

const ADDRESS = {
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

/** The retention cycle of the personal data of orders, over HTTP (T-232, UC-SYS-02, ADR-0070, ADR-0149). */
describe('Retention of personal data (e2e, T-232)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication<INestApplication<App>>();
    useTestAuthentication(app);
    configureHttp(app);
    await app.init();
    prisma = app.get(PrismaService);
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

  afterEach(async () => {
    await app.get(DomainEventDispatcher).whenIdle();
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { action: { startsWith: 'payments.' } },
          { action: { startsWith: 'orders.' } },
          { action: { startsWith: 'shipments.' } },
        ],
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
    await prisma.idempotencyKey.deleteMany();
    await prisma.cartLine.deleteMany();
    await prisma.cart.deleteMany();
    await prisma.pricePeriod.deleteMany();
    await prisma.variantPrice.deleteMany();
    await prisma.stockItem.deleteMany();
    await prisma.productVariant.deleteMany();
    await prisma.product.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const idle = () => app.get(DomainEventDispatcher).whenIdle();
  const retain = () =>
    app.get(ClsService).run(() => app.get(PersonalDataRetention).run());

  const staff = (...permissions: PermissionCode[]): AuthenticatedUser => ({
    id: newId(),
    type: 'STAFF',
    permissions,
    mustChangePassword: false,
    sessionId: newId(),
  });
  const reader = staff('orders.read');
  const cashier = staff('orders.read', 'payments.manage');
  const shipper = staff('shipping.manage');

  /** A published variant priced at $100.00, with 10 units. */
  async function variant(): Promise<string> {
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
            sku: `CAM-${id.slice(-12)}`.toUpperCase(),
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
            effectiveFrom: new Date(Date.now() - 86_400_000),
            createdBy: newId(),
          },
        },
      },
    });
    await prisma.stockItem.create({
      data: { id: newId(), variantId: id, warehouseId: MAIN, onHand: 10 },
    });
    return id;
  }

  /** A verified customer. */
  async function customer(): Promise<AuthenticatedUser> {
    const id = newId();
    await prisma.user.create({
      data: {
        id,
        type: 'CUSTOMER',
        email: `${id}@example.com`,
        firstNames: 'Ana',
        lastNames: 'Pérez',
        passwordHash: 'not-a-real-hash',
        emailVerifiedAt: new Date(),
        privacyNoticeVersion: '2026-09',
      },
    });
    return {
      id,
      type: 'CUSTOMER',
      permissions: [],
      mustChangePassword: false,
      sessionId: newId(),
    };
  }

  /** An order of one shirt of the customer, $199.00 with shipping. */
  async function customerOrder(
    buyer: AuthenticatedUser,
  ): Promise<{ id: string; publicCode: string }> {
    await http()
      .post('/v1/me/cart/lines')
      .set(signedInAs(buyer))
      .send({ variantId: await variant(), quantity: 1 })
      .expect(201);
    const { body } = await http()
      .post('/v1/me/orders')
      .set(signedInAs(buyer))
      .set('Idempotency-Key', randomUUID())
      .send({ shippingAddress: ADDRESS, expectedTotal: 19_900 })
      .expect(201);
    return idOf(body.publicCode as string);
  }

  /** A guest order of one shirt, $199.00 with shipping. */
  async function guestOrder(
    contactEmail: string,
  ): Promise<{ id: string; publicCode: string }> {
    const cartId = (await http().post('/v1/carts').expect(201)).body
      .id as string;
    await http()
      .post(`/v1/carts/${cartId}/lines`)
      .send({ variantId: await variant(), quantity: 1 })
      .expect(200);
    const { body } = await http()
      .post('/v1/orders')
      .set('Idempotency-Key', randomUUID())
      .send({
        cartId,
        contactEmail,
        shippingAddress: ADDRESS,
        expectedTotal: 19_900,
        privacyNoticeVersion: '2026-09',
      })
      .expect(201);
    return idOf(body.publicCode as string);
  }

  async function idOf(
    publicCode: string,
  ): Promise<{ id: string; publicCode: string }> {
    const { id } = await prisma.order.findFirstOrThrow({
      where: { publicCode: publicCode.replace('-', '') },
    });
    return { id, publicCode };
  }

  /** Paid in the store, shipped by the store itself and delivered: DELIVERED. Answers its shipment. */
  async function delivered(orderId: string): Promise<string> {
    await http()
      .post(`/v1/admin/orders/${orderId}/manual-capture`)
      .set(signedInAs(cashier))
      .send({ reference: 'Ticket 00452' })
      .expect(200);
    await idle();
    const shipment = (
      await http()
        .get(`/v1/admin/shipping/shipments?orderId=${orderId}`)
        .set(signedInAs(shipper))
        .expect(200)
    ).body.data[0];
    await http()
      .post(`/v1/admin/shipping/shipments/${shipment.id}/dispatch`)
      .set(signedInAs(shipper))
      .send({ ownDelivery: true, version: 1 })
      .expect(200);
    await http()
      .post(`/v1/admin/shipping/shipments/${shipment.id}/deliver`)
      .set(signedInAs(shipper))
      .send({ version: 2 })
      .expect(200);
    await idle();
    return shipment.id as string;
  }

  /** Moves when the orders concluded `months` months back, as if that time had passed. */
  const concludedMonthsAgo = (months: number, ...ids: string[]) =>
    prisma.order.updateMany({
      where: { id: { in: ids } },
      data: { concludedAt: monthsBefore(new Date(), months) },
    });

  const adminOrder = async (orderId: string) =>
    (
      await http()
        .get(`/v1/admin/orders/${orderId}`)
        .set(signedInAs(reader))
        .expect(200)
    ).body;

  const adminShipment = async (shipmentId: string) =>
    (
      await http()
        .get(`/v1/admin/shipping/shipments/${shipmentId}`)
        .set(signedInAs(shipper))
        .expect(200)
    ).body;

  it('concludes an order when it is delivered, and blocks it a year later: hidden from its buyer, shown to the staff without the buyer', async () => {
    const ana = await customer();
    const ofAna = await customerOrder(ana);
    const guest = 'invitado@example.com';
    const ofGuest = await guestOrder(guest);
    const shipmentOfAna = await delivered(ofAna.id);
    await delivered(ofGuest.id);
    const before = await adminOrder(ofAna.id);
    const { concludedAt } = await prisma.order.findUniqueOrThrow({
      where: { id: ofAna.id },
      select: { concludedAt: true },
    });
    expect(concludedAt?.toISOString()).toBe(before.deliveredAt);
    expect(before).toMatchObject({
      contactEmail: `${ana.id}@example.com`,
      blockedAt: null,
    });

    expect(await retain()).toEqual({ blocked: 0, anonymized: 0, failed: 0 });
    await concludedMonthsAgo(12, ofAna.id, ofGuest.id);
    expect(await retain()).toEqual({ blocked: 2, anonymized: 0, failed: 0 });

    const blocked = await adminOrder(ofAna.id);
    expect(blocked).toMatchObject({
      status: 'DELIVERED',
      contactEmail: null,
      shippingAddress: KEPT,
      blockedAt: expect.any(String),
      anonymizedAt: null,
      grandTotal: { amount: 19_900, currency: 'MXN' },
    });
    expect(await adminShipment(shipmentOfAna)).toMatchObject({
      status: 'DELIVERED',
      destination: KEPT,
      blockedAt: blocked.blockedAt,
    });
    // The data stays, only hidden: the database still has it.
    expect(
      await prisma.order.findUniqueOrThrow({
        where: { id: ofAna.id },
        select: { contactEmail: true },
      }),
    ).toEqual({ contactEmail: `${ana.id}@example.com` });
    const { body: mine } = await http()
      .get('/v1/me/orders')
      .set(signedInAs(ana))
      .expect(200);
    expect(mine.data).toEqual([]);
    await http()
      .get(`/v1/me/orders/${ofAna.publicCode}`)
      .set(signedInAs(ana))
      .expect(404);
    await http()
      .post('/v1/orders/lookup')
      .send({ contactEmail: guest, publicCode: ofGuest.publicCode })
      .expect(404);
    const { body: byEmail } = await http()
      .get(`/v1/admin/orders?q=${encodeURIComponent(guest)}`)
      .set(signedInAs(reader))
      .expect(200);
    expect(byEmail.data).toEqual([]);
    const { body: byCode } = await http()
      .get(`/v1/admin/orders?q=${ofGuest.publicCode}`)
      .set(signedInAs(reader))
      .expect(200);
    expect(byCode.data).toEqual([
      expect.objectContaining({
        id: ofGuest.id,
        contactEmail: null,
        blockedAt: expect.any(String),
      }),
    ]);
    expect(
      await prisma.auditLog.count({
        where: {
          action: 'orders.block',
          actorType: 'SYSTEM',
          resourceId: { in: [ofAna.id, ofGuest.id] },
        },
      }),
    ).toBe(2);
  });

  it('anonymizes a blocked order five years later, with its shipment', async () => {
    const ofGuest = await guestOrder('invitado@example.com');
    const shipmentId = await delivered(ofGuest.id);
    await concludedMonthsAgo(12, ofGuest.id);
    await retain();

    await concludedMonthsAgo(72, ofGuest.id);
    expect(await retain()).toEqual({ blocked: 0, anonymized: 1, failed: 0 });

    const anonymized = await adminOrder(ofGuest.id);
    expect(anonymized).toMatchObject({
      status: 'DELIVERED',
      contactEmail: null,
      shippingAddress: KEPT,
      anonymizedAt: expect.any(String),
      blockedAt: expect.any(String),
    });
    expect(await adminShipment(shipmentId)).toMatchObject({
      destination: KEPT,
    });
    expect(
      await prisma.order.findUniqueOrThrow({
        where: { id: ofGuest.id },
        select: { contactEmail: true },
      }),
    ).toEqual({ contactEmail: null });
    expect(
      await prisma.auditLog.findFirstOrThrow({
        where: { action: 'orders.anonymize', resourceId: ofGuest.id },
        select: { actorType: true, reason: true },
      }),
    ).toEqual({
      actorType: 'SYSTEM',
      reason: 'Plazo de conservación de datos personales vencido (ADR-0149)',
    });
  });
});
