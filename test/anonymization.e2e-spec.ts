import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import type { AuthenticatedUser } from '../src/platform/auth/authenticated-user.js';
import { DomainEventDispatcher } from '../src/platform/events/domain-event-dispatcher.js';
import { configureHttp } from '../src/platform/http/configure-http.js';
import { PrismaService } from '../src/platform/persistence/prisma.service.js';
import { newId, type PermissionCode } from '../src/shared-kernel/index.js';
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

const problem = (type: string) => ({ type: `/problems/${type}` });

/** The anonymizations of customers and guest buyers over HTTP (T-132, UC-IAM-19, ADR-0067, ADR-0145). */
describe('Anonymization (e2e, T-132)', () => {
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
          { action: { startsWith: 'customers.' } },
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
    await prisma.refreshToken.deleteMany();
    await prisma.customerAddress.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const idle = () => app.get(DomainEventDispatcher).whenIdle();

  const staff = (...permissions: PermissionCode[]): AuthenticatedUser => ({
    id: newId(),
    type: 'STAFF',
    permissions,
    mustChangePassword: false,
    sessionId: newId(),
  });
  const privacyOfficer = staff('customers.read', 'customers.manage');
  const reader = staff('customers.read', 'orders.read', 'shipping.manage');
  const cashier = staff('orders.read', 'payments.manage');
  const manager = staff('orders.read', 'orders.manage');
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

  /** A verified customer with a saved address and a session. */
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
    await prisma.customerAddress.create({
      data: { id: newId(), userId: id, ...ADDRESS, isDefault: true },
    });
    await prisma.refreshToken.create({
      data: {
        id: newId(),
        userId: id,
        sessionId: newId(),
        tokenHash: `refresh-${id}`,
        expiresAt: new Date(Date.now() + 86_400_000),
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

  /** The staff cancels an order, unpaid or paid. */
  const cancel = (orderId: string, version: number) =>
    http()
      .post(`/v1/admin/orders/${orderId}/cancel`)
      .set(signedInAs(manager))
      .send({ reason: 'Sin stock', version });

  const anonymize = (
    userId: string,
    body: object = { reason: 'ARCO-2026-0042', version: 1 },
    user = privacyOfficer,
  ) =>
    http()
      .post(`/v1/admin/identity/customers/${userId}/anonymize`)
      .set(signedInAs(user))
      .send(body);

  const anonymizeGuest = (body: object, user = privacyOfficer) =>
    http()
      .post('/v1/admin/identity/guest-anonymizations')
      .set(signedInAs(user))
      .send(body);

  const adminCustomer = async (userId: string) =>
    (
      await http()
        .get(`/v1/admin/identity/customers/${userId}`)
        .set(signedInAs(reader))
        .expect(200)
    ).body;

  const adminOrder = async (orderId: string) =>
    (
      await http()
        .get(`/v1/admin/orders/${orderId}`)
        .set(signedInAs(reader))
        .expect(200)
    ).body;

  describe('a customer', () => {
    it('anonymizes the account and the orders that concluded, which the staff still reads without the buyer', async () => {
      const ana = await customer();
      const order = await customerOrder(ana);
      const shipmentId = await delivered(order.id);
      await http()
        .post('/v1/me/cart/lines')
        .set(signedInAs(ana))
        .send({ variantId: await variant(), quantity: 1 })
        .expect(201);

      const { body } = await anonymize(ana.id).expect(200);

      expect(body).toEqual({
        userId: ana.id,
        anonymizedAt: expect.any(String),
        anonymizedOrderCount: 1,
      });
      expect(await adminCustomer(ana.id)).toMatchObject({
        id: ana.id,
        email: null,
        firstNames: null,
        lastNames: null,
        status: 'ANONYMIZED',
        emailVerified: false,
        anonymizedAt: body.anonymizedAt,
        addresses: [],
        version: 2,
      });
      expect(await adminOrder(order.id)).toMatchObject({
        status: 'DELIVERED',
        contactEmail: null,
        shippingAddress: KEPT,
        anonymizedAt: body.anonymizedAt,
        grandTotal: { amount: 19_900, currency: 'MXN' },
      });
      expect(
        (
          await http()
            .get(`/v1/admin/shipping/shipments/${shipmentId}`)
            .set(signedInAs(shipper))
            .expect(200)
        ).body,
      ).toMatchObject({ status: 'DELIVERED', destination: KEPT });
      expect(await prisma.cart.count({ where: { ownerUserId: ana.id } })).toBe(
        0,
      );
      expect(
        await prisma.refreshToken.count({ where: { userId: ana.id } }),
      ).toBe(0);
      // The response kept for placing the order repeated its email and address (ADR-0145).
      expect(
        await prisma.idempotencyKey.count({ where: { scopeId: ana.id } }),
      ).toBe(0);
      expect(
        (
          await prisma.auditLog.findMany({
            where: { reason: 'ARCO-2026-0042' },
            orderBy: { action: 'asc' },
          })
        ).map(({ action, resourceId, actorId }) => ({
          action,
          resourceId,
          actorId,
        })),
      ).toEqual([
        {
          action: 'customers.anonymize',
          resourceId: ana.id,
          actorId: privacyOfficer.id,
        },
        {
          action: 'orders.anonymize',
          resourceId: order.id,
          actorId: privacyOfficer.id,
        },
      ]);

      expect(
        (
          await anonymize(ana.id, {
            reason: 'ARCO-2026-0042',
            version: 2,
          }).expect(409)
        ).body,
      ).toMatchObject({
        ...problem('invalid-state-transition'),
        currentStatus: 'ANONYMIZED',
      });
    });

    it('waits for an order that has not concluded, changing nothing (E-31)', async () => {
      const ana = await customer();
      const order = await customerOrder(ana);

      expect((await anonymize(ana.id).expect(409)).body).toMatchObject(
        problem('active-orders-exist'),
      );

      expect(await adminCustomer(ana.id)).toMatchObject({
        email: `${ana.id}@example.com`,
        status: 'ACTIVE',
        version: 1,
      });
      expect(await adminOrder(order.id)).toMatchObject({
        contactEmail: `${ana.id}@example.com`,
        anonymizedAt: null,
      });
    });

    it('needs customers.manage, a customer, the current version and a reason of up to 250 characters', async () => {
      const ana = await customer();
      const someone = staff('customers.manage');
      await prisma.user.create({
        data: {
          id: someone.id,
          type: 'STAFF',
          email: `${someone.id}@example.com`,
          firstNames: 'Luis',
          lastNames: 'Gómez',
          passwordHash: 'not-a-real-hash',
        },
      });

      await http()
        .post(`/v1/admin/identity/customers/${ana.id}/anonymize`)
        .send({ reason: 'ARCO-2026-0042', version: 1 })
        .expect(401);
      await anonymize(ana.id, undefined, reader).expect(403);
      await anonymize(someone.id).expect(404);
      await anonymize('not-an-id').expect(404);
      expect(
        (
          await anonymize(ana.id, {
            reason: 'ARCO-2026-0042',
            version: 3,
          }).expect(409)
        ).body,
      ).toMatchObject({ ...problem('version-conflict'), currentVersion: 1 });
      for (const reason of ['', '   ', 'x'.repeat(251)]) {
        await anonymize(ana.id, { reason, version: 1 }).expect(400);
      }
      expect(await adminCustomer(ana.id)).toMatchObject({ status: 'ACTIVE' });
      await anonymize(ana.id, { reason: 'x'.repeat(250), version: 1 }).expect(
        200,
      );
    });

    it('leaves a late payment of an expired order, once anonymized, waiting for the staff, who can only cancel it with its refund (ADR-0145)', async () => {
      const ana = await customer();
      const order = await customerOrder(ana);
      // The order expired without payment, and its reservation with it.
      await prisma.order.update({
        where: { id: order.id },
        data: { status: 'EXPIRED', expiredAt: new Date() },
      });
      await prisma.reservation.updateMany({
        where: { orderId: order.id },
        data: { status: 'EXPIRED' },
      });
      await anonymize(ana.id).expect(200);

      await http()
        .post(`/v1/admin/orders/${order.id}/manual-capture`)
        .set(signedInAs(cashier))
        .send({ reference: 'Ticket 00453' })
        .expect(200);
      await idle();

      expect(await adminOrder(order.id)).toMatchObject({
        status: 'AWAITING_MANUAL_FULFILLMENT',
        shipment: null,
        version: 3,
      });
      expect(
        (
          await http()
            .post(`/v1/admin/orders/${order.id}/retry-fulfillment`)
            .set(signedInAs(manager))
            .send({ version: 3 })
            .expect(409)
        ).body,
      ).toMatchObject({
        ...problem('invalid-state-transition'),
        currentStatus: 'AWAITING_MANUAL_FULFILLMENT',
      });
      const { body } = await cancel(order.id, 3).expect(200);
      expect(body).toMatchObject({
        status: 'CANCELLED',
        payment: { refunds: [{ status: 'PENDING' }] },
      });
    });
  });

  describe('a guest buyer', () => {
    it('anonymizes every guest order with the email and their shipments, so the lookup no longer finds them', async () => {
      const email = 'invitada@example.com';
      const first = await guestOrder(email);
      const shipmentId = await delivered(first.id);
      const second = await guestOrder(email);
      await cancel(second.id, 1).expect(200);
      const another = await guestOrder('otra@example.com');

      expect(
        (
          await anonymizeGuest({
            contactEmail: 'Invitada@Example.com',
            publicCode: second.publicCode.toLowerCase(),
            reason: 'ARCO-2026-0043',
          }).expect(200)
        ).body,
      ).toEqual({ anonymizedOrderCount: 2 });

      for (const { id } of [first, second]) {
        expect(await adminOrder(id)).toMatchObject({
          contactEmail: null,
          shippingAddress: KEPT,
          anonymizedAt: expect.any(String),
        });
      }
      expect(await adminOrder(another.id)).toMatchObject({
        contactEmail: 'otra@example.com',
        anonymizedAt: null,
      });
      expect(
        (
          await http()
            .get(`/v1/admin/shipping/shipments/${shipmentId}`)
            .set(signedInAs(shipper))
            .expect(200)
        ).body.destination,
      ).toEqual(KEPT);
      await http()
        .post('/v1/orders/lookup')
        .send({ contactEmail: email, publicCode: first.publicCode })
        .expect(404);
      const carts = await prisma.order.findMany({
        where: { id: { in: [first.id, second.id, another.id] } },
        select: { sourceCartId: true, contactEmail: true },
      });
      const keptFor = async (anonymized: boolean) =>
        prisma.idempotencyKey.count({
          where: {
            scopeType: 'CART',
            scopeId: {
              in: carts
                .filter(
                  ({ contactEmail }) => (contactEmail === null) === anonymized,
                )
                .map(({ sourceCartId }) => sourceCartId),
            },
          },
        });
      expect([await keptFor(true), await keptFor(false)]).toEqual([0, 1]);
      expect(
        await prisma.auditLog.count({
          where: { action: 'orders.anonymize', reason: 'ARCO-2026-0043' },
        }),
      ).toBe(2);
    });

    it('answers the same 404 as the lookup when the email and the code do not match, also once anonymized', async () => {
      const order = await guestOrder('invitada@example.com');
      await cancel(order.id, 1).expect(200);
      const another = await guestOrder('otra@example.com');
      const request = (contactEmail: string, publicCode: string) =>
        anonymizeGuest({ contactEmail, publicCode, reason: 'ARCO-2026-0043' });

      for (const [email, code] of [
        ['invitada@example.com', another.publicCode],
        ['otra@example.com', order.publicCode],
        ['invitada@example.com', 'ZZZZ-ZZZZ'],
      ]) {
        expect((await request(email, code).expect(404)).body).toMatchObject(
          problem('not-found'),
        );
      }
      await request('invitada@example.com', order.publicCode).expect(200);
      await request('invitada@example.com', order.publicCode).expect(404);
    });

    it('waits for a guest order that has not concluded, and needs customers.manage and a valid request', async () => {
      const order = await guestOrder('invitada@example.com');
      const body = {
        contactEmail: 'invitada@example.com',
        publicCode: order.publicCode,
        reason: 'ARCO-2026-0043',
      };

      await anonymizeGuest(body, reader).expect(403);
      await anonymizeGuest({ ...body, contactEmail: 'no es un email' }).expect(
        400,
      );
      await anonymizeGuest({ ...body, reason: undefined }).expect(400);
      expect((await anonymizeGuest(body).expect(409)).body).toMatchObject(
        problem('active-orders-exist'),
      );
      expect(await adminOrder(order.id)).toMatchObject({
        contactEmail: 'invitada@example.com',
        anonymizedAt: null,
      });
    });
  });
});
