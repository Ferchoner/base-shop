import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { OrderExpiry } from '../src/modules/ordering/application/order-expiry.use-case.js';
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
  neighborhood: 'Centro',
  postalCode: '58000',
  stateCode: '16',
  municipalityCode: '16053',
};

const mxn = (amount: number) => ({ amount, currency: 'MXN' });

/** Paying in the store over HTTP (T-190 part a, UC-PAY-01 and 02, ADR-0134). */
describe('In-store payment (e2e, T-190)', () => {
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
      where: { action: { startsWith: 'payments.' } },
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

  const staff = (...permissions: PermissionCode[]): AuthenticatedUser => ({
    id: newId(),
    type: 'STAFF',
    permissions,
    mustChangePassword: false,
    sessionId: newId(),
  });
  const cashier = staff('orders.read', 'payments.manage');
  const manager = staff('orders.read', 'orders.manage');

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
      data: { id: newId(), variantId: id, warehouseId: MAIN, onHand: stock },
    });
    return id;
  }

  /** A guest order of one unit: $100.00 plus $99.00 of shipping. */
  async function guestOrder(
    variantId: string,
  ): Promise<{ id: string; publicCode: string; cartId: string }> {
    const cartId = (await http().post('/v1/carts').expect(201)).body
      .id as string;
    await http()
      .post(`/v1/carts/${cartId}/lines`)
      .send({ variantId, quantity: 1 })
      .expect(200);
    const { body } = await http()
      .post('/v1/orders')
      .set('Idempotency-Key', randomUUID())
      .send({
        cartId,
        contactEmail: 'cliente@example.com',
        shippingAddress: ADDRESS,
        expectedTotal: 19_900,
        privacyNoticeVersion: '2026-09',
      })
      .expect(201);
    const publicCode = body.publicCode as string;
    const { id } = await prisma.order.findFirstOrThrow({
      where: { publicCode: publicCode.replace('-', '') },
    });
    return { id, publicCode, cartId };
  }

  /** A verified customer with an order of one unit. */
  async function customerOrder(
    variantId: string,
  ): Promise<{ customer: AuthenticatedUser; publicCode: string }> {
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
      },
    });
    const customer: AuthenticatedUser = {
      id,
      type: 'CUSTOMER',
      permissions: [],
      mustChangePassword: false,
      sessionId: newId(),
    };
    await http()
      .post('/v1/me/cart/lines')
      .set(signedInAs(customer))
      .send({ variantId, quantity: 1 })
      .expect(201);
    const { body } = await http()
      .post('/v1/me/orders')
      .set(signedInAs(customer))
      .set('Idempotency-Key', randomUUID())
      .send({ shippingAddress: ADDRESS, expectedTotal: 19_900 })
      .expect(201);
    return { customer, publicCode: body.publicCode as string };
  }

  const startAsGuest = (
    publicCode: string,
    body: object,
    key: string = randomUUID(),
  ) =>
    http()
      .post(`/v1/orders/${publicCode}/payments`)
      .set('Idempotency-Key', key)
      .send(body);

  const capture = (orderId: string, user = cashier, body: object = {}) =>
    http()
      .post(`/v1/admin/orders/${orderId}/manual-capture`)
      .set(signedInAs(user))
      .send({ reference: 'Ticket 00452', note: 'Pagó en efectivo', ...body });

  describe('starting a payment (UC-PAY-01)', () => {
    it('tells a guest to pay in the store with the code and the total, and answers the same payment again', async () => {
      const { publicCode, cartId } = await guestOrder(await variant());

      const first = await startAsGuest(publicCode, {
        cartId,
        provider: 'MANUAL',
      }).expect(201);
      const again = await startAsGuest(publicCode, {
        cartId,
        provider: 'MANUAL',
      }).expect(200);

      expect(first.body).toEqual({
        paymentId: expect.any(String),
        provider: 'MANUAL',
        status: 'PENDING',
        amount: mxn(19_900),
        action: {
          type: 'PAY_IN_STORE',
          orderCode: publicCode,
          amount: mxn(19_900),
          instructions: 'Presenta este código en la tienda para pagar.',
        },
      });
      expect(again.body).toEqual(first.body);
      expect(await prisma.payment.count()).toBe(1);
      const order = await http()
        .get(`/v1/admin/orders?q=${publicCode}`)
        .set(signedInAs(cashier))
        .expect(200);
      expect(order.body.data[0].payment).toMatchObject({
        id: first.body.paymentId,
        provider: 'MANUAL',
        status: 'PENDING',
        amount: mxn(19_900),
        capturedAmount: mxn(0),
        refunds: [],
      });
    });

    it('lets a customer start the payment of their own order only', async () => {
      const shirt = await variant();
      const { customer, publicCode } = await customerOrder(shirt);
      const other = await customerOrder(shirt);
      const start = (user: AuthenticatedUser, code: string) =>
        http()
          .post(`/v1/me/orders/${code.toLowerCase()}/payments`)
          .set(signedInAs(user))
          .set('Idempotency-Key', randomUUID())
          .send({ provider: 'MANUAL' });

      await start(customer, publicCode).expect(201);
      await start(customer, other.publicCode).expect(404);
      const { body } = await http()
        .get(`/v1/me/orders/${publicCode}`)
        .set(signedInAs(customer))
        .expect(200);
      expect(body.payment).toEqual({ provider: 'MANUAL', status: 'PENDING' });

      // Once the store registers it, the customer sees it captured, in the order and in the listing.
      const { id } = await prisma.order.findFirstOrThrow({
        where: { publicCode: publicCode.replace('-', '') },
      });
      await capture(id).expect(200);
      await idle();
      const paid = await http()
        .get(`/v1/me/orders/${publicCode}`)
        .set(signedInAs(customer))
        .expect(200);
      const listed = await http()
        .get('/v1/me/orders')
        .set(signedInAs(customer))
        .expect(200);
      expect(paid.body).toMatchObject({
        status: 'PAID',
        payment: { provider: 'MANUAL', status: 'CAPTURED' },
      });
      expect(listed.body.data[0].payment).toEqual({
        provider: 'MANUAL',
        status: 'CAPTURED',
      });
    });

    it('answers 404 for an order that does not exist or is not the payer’s', async () => {
      const shirt = await variant();
      const { publicCode, cartId } = await guestOrder(shirt);
      const ofCustomer = await customerOrder(shirt);
      const customerCart = await prisma.order.findFirstOrThrow({
        where: { publicCode: ofCustomer.publicCode.replace('-', '') },
      });

      for (const [code, cart] of [
        [publicCode, randomUUID()],
        ['ZZZZ-ZZZZ', cartId],
        ['no-es-un-codigo', cartId],
        [ofCustomer.publicCode, customerCart.sourceCartId as string],
      ]) {
        const response = await startAsGuest(code, {
          cartId: cart,
          provider: 'MANUAL',
        }).expect(404);
        expect(response.body.type).toBe('/problems/not-found');
      }
    });

    it('answers 400 for a provider that is not enabled, and 409 for an order that is not pending', async () => {
      const shirt = await variant();
      const { id, publicCode, cartId } = await guestOrder(shirt);

      const paypal = await startAsGuest(publicCode, {
        cartId,
        provider: 'PAYPAL',
      }).expect(400);
      await startAsGuest(publicCode, { cartId, provider: 'CASH' }).expect(400);
      await http()
        .post(`/v1/admin/orders/${id}/cancel`)
        .set(signedInAs(manager))
        .send({ reason: 'Duplicado', version: 1 })
        .expect(200);
      const cancelled = await startAsGuest(publicCode, {
        cartId,
        provider: 'MANUAL',
      }).expect(409);

      expect(paypal.body.errors).toEqual([
        expect.objectContaining({
          field: 'provider',
          code: 'isEnabledProvider',
        }),
      ]);
      expect(cancelled.body).toMatchObject({
        type: '/problems/invalid-state-transition',
        currentStatus: 'CANCELLED',
      });
    });

    it('needs the Idempotency-Key, and keeps the staff out', async () => {
      const { publicCode, cartId } = await guestOrder(await variant());

      await http()
        .post(`/v1/orders/${publicCode}/payments`)
        .send({ cartId, provider: 'MANUAL' })
        .expect(400);
      const staffResponse = await http()
        .post(`/v1/orders/${publicCode}/payments`)
        .set(signedInAs(cashier))
        .set('Idempotency-Key', randomUUID())
        .send({ cartId, provider: 'MANUAL' })
        .expect(403);

      expect(staffResponse.body.type).toBe('/problems/staff-cannot-purchase');
    });
  });

  describe('registering a payment made in the store (UC-PAY-02)', () => {
    it('captures the total, audits it, and the order becomes paid in the background', async () => {
      const shirt = await variant(5);
      const { id, publicCode, cartId } = await guestOrder(shirt);
      const started = await startAsGuest(publicCode, {
        cartId,
        provider: 'MANUAL',
      }).expect(201);

      const { body } = await capture(id).expect(200);
      await idle();

      expect(body.payment).toMatchObject({
        id: started.body.paymentId,
        status: 'CAPTURED',
        capturedAmount: mxn(19_900),
        capturedAt: expect.any(String),
      });
      const order = await http()
        .get(`/v1/admin/orders/${id}`)
        .set(signedInAs(cashier))
        .expect(200);
      expect(order.body).toMatchObject({
        status: 'PAID',
        paidAt: body.payment.capturedAt,
      });
      expect(
        await prisma.stockItem.findFirstOrThrow({
          where: { variantId: shirt },
        }),
      ).toMatchObject({ onHand: 4, reserved: 0 });
      const payment = await http()
        .get(`/v1/admin/payments/${started.body.paymentId}`)
        .set(signedInAs(cashier))
        .expect(200);
      expect(payment.body).toMatchObject({
        orderId: id,
        orderCode: publicCode,
        provider: 'MANUAL',
        status: 'CAPTURED',
        currency: 'MXN',
        version: 2,
        attempts: [
          { status: 'PENDING', providerReference: null, registeredBy: null },
          {
            status: 'CAPTURED',
            providerReference: 'Ticket 00452',
            registeredBy: cashier.id,
          },
        ],
        refunds: [],
      });
      expect(
        await prisma.auditLog.findFirstOrThrow({
          where: { action: 'payments.manual-capture' },
        }),
      ).toMatchObject({
        actorId: cashier.id,
        resourceId: started.body.paymentId,
        reason: 'Pagó en efectivo',
        changes: { status: { from: 'PENDING', to: 'CAPTURED' } },
      });
    });

    it('creates the payment when the customer never started it, and pays an expired order as a late payment', async () => {
      const shirt = await variant(5);
      const { id } = await guestOrder(shirt);
      // Its payment is due, and the expiration job ends it with its reservation (ADR-0136).
      await prisma.order.update({
        where: { id },
        data: { paymentDueAt: new Date(Date.now() - 1_000) },
      });
      await app.get(ClsService).run(() => app.get(OrderExpiry).expireDue());

      const { body } = await capture(id, cashier, { note: ' ' }).expect(200);
      await idle();

      expect(body.payment).toMatchObject({
        provider: 'MANUAL',
        status: 'CAPTURED',
      });
      expect(
        (await prisma.order.findUniqueOrThrow({ where: { id } })).status,
      ).toBe('PAID');
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'payments.manual-capture' },
      });
      expect(audit.reason).toBeNull();
    });

    it('answers 409 for a payment already captured or an order that cannot be paid', async () => {
      const shirt = await variant();
      const paid = await guestOrder(shirt);
      const cancelled = await guestOrder(shirt);
      await capture(paid.id).expect(200);
      await idle();
      await http()
        .post(`/v1/admin/orders/${cancelled.id}/cancel`)
        .set(signedInAs(manager))
        .send({ reason: 'Duplicado', version: 1 })
        .expect(200);

      const again = await capture(paid.id).expect(409);
      const ofCancelled = await capture(cancelled.id).expect(409);

      expect(again.body).toMatchObject({
        type: '/problems/invalid-state-transition',
        currentStatus: 'PAID',
      });
      expect(ofCancelled.body.currentStatus).toBe('CANCELLED');
      expect(await prisma.payment.count()).toBe(1);
    });

    it('answers 409 when the payment was captured but the order is not paid yet', async () => {
      const { id } = await guestOrder(await variant());
      const payment = newId();
      await prisma.payment.create({
        data: {
          id: payment,
          orderId: id,
          orderCode: 'K7M4Q9XA',
          provider: 'MANUAL',
          status: 'CAPTURED',
          amount: 19_900,
          capturedAmount: 19_900,
          currency: 'MXN',
          capturedAt: new Date(),
        },
      });

      const response = await capture(id).expect(409);

      expect(response.body).toMatchObject({
        type: '/problems/invalid-state-transition',
        currentStatus: 'CAPTURED',
      });
    });

    it('needs payments.manage, a receipt and an order that exists', async () => {
      const { id } = await guestOrder(await variant());

      await capture(id, manager).expect(403);
      await capture(id, cashier, { reference: ' ' }).expect(400);
      await capture(id, cashier, { note: 'x'.repeat(501) }).expect(400);
      await capture(newId()).expect(404);
    });
  });

  describe("the staff's payments", () => {
    it('lists payments with their filters, and answers 404 for one that does not exist', async () => {
      const shirt = await variant();
      const first = await guestOrder(shirt);
      const second = await guestOrder(shirt);
      await startAsGuest(first.publicCode, {
        cartId: first.cartId,
        provider: 'MANUAL',
      }).expect(201);
      await capture(second.id).expect(200);
      await idle();
      const list = (query: string) =>
        http()
          .get(`/v1/admin/payments?${query}`)
          .set(signedInAs(cashier))
          .expect(200);

      const all = await list('');
      const captured = await list('status=CAPTURED');
      const ofOrder = await list(`orderId=${first.id}`);
      const later = await list(
        `capturedFrom=${new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)}`,
      );

      expect(all.body.meta.totalItems).toBe(2);
      expect(all.body.data[0].orderId).toBe(second.id);
      expect(
        captured.body.data.map(({ orderId }: { orderId: string }) => orderId),
      ).toEqual([second.id]);
      expect(ofOrder.body.data[0].orderCode).toBe(first.publicCode);
      expect(later.body.meta.totalItems).toBe(0);
      await http()
        .get(`/v1/admin/payments/${newId()}`)
        .set(signedInAs(cashier))
        .expect(404);
      await http()
        .get('/v1/admin/payments')
        .set(signedInAs(staff('customers.read')))
        .expect(403);
    });
  });
});
