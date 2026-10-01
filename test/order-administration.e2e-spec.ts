import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import type { PaymentCaptured } from '../src/modules/ordering/infrastructure/payment-captured.event-handler.js';
import type { AuthenticatedUser } from '../src/platform/auth/authenticated-user.js';
import { DomainEventDispatcher } from '../src/platform/events/domain-event-dispatcher.js';
import { configureHttp } from '../src/platform/http/configure-http.js';
import { PrismaService } from '../src/platform/persistence/prisma.service.js';
import {
  DomainEventPublisher,
  eventMetadata,
  type PermissionCode,
  newId,
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
  neighborhood: 'Centro',
  postalCode: '58000',
  stateCode: '16',
  municipalityCode: '16053',
};

const mxn = (amount: number) => ({ amount, currency: 'MXN' });

/** The staff's orders over HTTP, and the payment that marks them paid (T-180 part b, UC-ORD-06 to 09). */
describe('Order administration (e2e, T-180)', () => {
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
    await prisma.auditLog.deleteMany({
      where: { action: { startsWith: 'orders.' } },
    });
    await prisma.orderStatusHistory.deleteMany();
    await prisma.orderLine.deleteMany();
    await prisma.order.deleteMany();
    await prisma.reservation.deleteMany();
    await prisma.stockMovement.deleteMany();
    await prisma.refund.deleteMany();
    await prisma.paymentAttempt.deleteMany();
    await prisma.payment.deleteMany();
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

  const staff = (...permissions: PermissionCode[]): AuthenticatedUser => ({
    id: newId(),
    type: 'STAFF',
    permissions,
    mustChangePassword: false,
    sessionId: newId(),
  });
  const reader = staff('orders.read');
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

  /** A guest order of `units` units of the variant, $100.00 each plus $99.00 of shipping. */
  async function guestOrder(
    variantId: string,
    units = 1,
    contactEmail = 'cliente@example.com',
  ): Promise<{ id: string; publicCode: string }> {
    const cartId = (await http().post('/v1/carts').expect(201)).body
      .id as string;
    await http()
      .post(`/v1/carts/${cartId}/lines`)
      .send({ variantId, quantity: units })
      .expect(200);
    const { body } = await http()
      .post('/v1/orders')
      .set('Idempotency-Key', randomUUID())
      .send({
        cartId,
        contactEmail,
        shippingAddress: ADDRESS,
        expectedTotal: units * 10_000 + 9_900,
        privacyNoticeVersion: '2026-09',
      })
      .expect(201);
    const { id } = await prisma.order.findFirstOrThrow({
      where: { publicCode: (body.publicCode as string).replace('-', '') },
    });
    return { id, publicCode: body.publicCode as string };
  }

  /** A verified customer's order of one unit. */
  async function customerOrder(variantId: string): Promise<string> {
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
    await http()
      .post('/v1/me/orders')
      .set(signedInAs(customer))
      .set('Idempotency-Key', randomUUID())
      .send({ shippingAddress: ADDRESS, expectedTotal: 19_900 })
      .expect(201);
    return id;
  }

  /** Publishes `PaymentCaptured` as Payments will (T-190), and waits for its handlers. */
  async function capture(
    orderId: string,
    amount: number,
    capturedAt = new Date('2026-10-01T15:00:00.000Z'),
  ): Promise<void> {
    const event: PaymentCaptured = {
      ...eventMetadata('PaymentCaptured', capturedAt),
      paymentId: newId(),
      orderId,
      amount: { amount, currency: 'MXN' },
    };
    await app
      .get(ClsService)
      .run(async () => app.get(DomainEventPublisher).publish(event));
    await app.get(DomainEventDispatcher).whenIdle();
  }

  /** What the expiration job of T-230 will do: the order and its reservation expire, and the stock is freed. */
  async function expire(orderId: string, variantId: string): Promise<void> {
    await prisma.order.update({
      where: { id: orderId },
      data: { status: 'EXPIRED', expiredAt: new Date() },
    });
    await prisma.reservation.updateMany({
      where: { orderId },
      data: { status: 'EXPIRED' },
    });
    await prisma.stockItem.updateMany({
      where: { variantId },
      data: { reserved: 0 },
    });
  }

  const stockOf = (variantId: string) =>
    prisma.stockItem.findFirstOrThrow({ where: { variantId } });

  const detail = (orderId: string, user = reader) =>
    http().get(`/v1/admin/orders/${orderId}`).set(signedInAs(user));

  describe('listing and detail (UC-ORD-06)', () => {
    it('shows an order with both identifiers and its status history', async () => {
      const shirt = await variant();
      const { id, publicCode } = await guestOrder(shirt, 2);

      const { body } = await detail(id).expect(200);

      const row = await prisma.order.findUniqueOrThrow({ where: { id } });
      expect(body).toMatchObject({
        id,
        orderNumber: Number(row.orderNumber),
        publicCode,
        customerId: null,
        status: 'PENDING_PAYMENT',
        version: 1,
        anonymizedAt: null,
        itemCount: 2,
        grandTotal: mxn(29_900),
        payment: null,
        shipment: null,
        lines: [expect.objectContaining({ lineNumber: 1, quantity: 2 })],
        shippingAddress: expect.objectContaining({
          municipalityName: 'Morelia',
        }),
        statusHistory: [
          {
            fromStatus: null,
            toStatus: 'PENDING_PAYMENT',
            actorId: null,
            reason: null,
            occurredAt: row.placedAt.toISOString(),
          },
        ],
      });
    });

    it('lists every order, newest first, without lines nor history', async () => {
      const shirt = await variant();
      const first = await guestOrder(shirt);
      const second = await guestOrder(shirt);

      const { body } = await http()
        .get('/v1/admin/orders')
        .set(signedInAs(reader))
        .expect(200);

      expect(body.meta.totalItems).toBe(2);
      expect(body.data.map(({ id }: { id: string }) => id)).toEqual([
        second.id,
        first.id,
      ]);
      expect(body.data[0]).toMatchObject({
        orderNumber: expect.any(Number),
        version: 1,
        shippingAddress: expect.objectContaining({ stateCode: '16' }),
      });
      expect(body.data[0]).not.toHaveProperty('lines');
      expect(body.data[0]).not.toHaveProperty('statusHistory');
    });

    it('searches by internal number, public code or part of the contact email (ADR-0133)', async () => {
      const shirt = await variant();
      const ana = await guestOrder(shirt, 1, 'ana.lopez@example.com');
      const luis = await guestOrder(shirt, 1, 'luis@example.com');
      const { orderNumber } = await prisma.order.findUniqueOrThrow({
        where: { id: luis.id },
      });
      const found = async (q: string) =>
        (
          await http()
            .get('/v1/admin/orders')
            .query({ q })
            .set(signedInAs(reader))
            .expect(200)
        ).body.data.map(({ id }: { id: string }) => id);

      expect(await found(String(orderNumber))).toEqual([luis.id]);
      expect(await found(ana.publicCode)).toEqual([ana.id]);
      expect(
        await found(ana.publicCode.replace('-', '').toLowerCase()),
      ).toEqual([ana.id]);
      expect(await found('ANA.LOPEZ')).toEqual([ana.id]);
      expect(await found('nadie')).toEqual([]);
      // Beyond the largest internal number: only the email could match.
      expect(await found('9999999999999999999')).toEqual([]);
      expect(await found('99999999999999999999')).toEqual([]);
    });

    it('filters by status, customer, guest, dates and pending refund, and sorts by number', async () => {
      const shirt = await variant();
      const guest = await guestOrder(shirt);
      const customer = await customerOrder(shirt);
      const cancelled = await guestOrder(shirt);
      await http()
        .post(`/v1/admin/orders/${cancelled.id}/cancel`)
        .set(signedInAs(manager))
        .send({ reason: 'Pedido duplicado', version: 1 })
        .expect(200);
      const ids = async (query: Record<string, string>) =>
        (
          await http()
            .get('/v1/admin/orders')
            .query(query)
            .set(signedInAs(reader))
            .expect(200)
        ).body.data.map(({ id }: { id: string }) => id);
      const customerOrderId = (
        await prisma.order.findFirstOrThrow({ where: { customerId: customer } })
      ).id;

      expect(await ids({ status: 'CANCELLED' })).toEqual([cancelled.id]);
      expect(await ids({ customerId: customer })).toEqual([customerOrderId]);
      expect(await ids({ guest: 'false' })).toEqual([customerOrderId]);
      expect(await ids({ guest: 'true', sort: 'orderNumber' })).toEqual([
        guest.id,
        cancelled.id,
      ]);
      expect(await ids({ hasPendingRefund: 'true' })).toEqual([]);
      expect((await ids({ hasPendingRefund: 'false' })).length).toBe(3);
      const tomorrow = new Date(Date.now() + 86_400_000)
        .toISOString()
        .slice(0, 10);
      expect(await ids({ placedFrom: tomorrow })).toEqual([]);
      await http()
        .get('/v1/admin/orders?sort=total')
        .set(signedInAs(reader))
        .expect(400);
    });

    it('answers 404 for an order that does not exist and 403 without orders.read', async () => {
      await detail(newId()).expect(404);
      await detail('no-es-un-id').expect(404);
      await http()
        .get('/v1/admin/orders')
        .set(signedInAs(staff('customers.read')))
        .expect(403);
    });
  });

  describe('cancelling (UC-ORD-07)', () => {
    it('cancels an unpaid order, frees its stock, and keeps who and why', async () => {
      const shirt = await variant();
      const { id } = await guestOrder(shirt, 2);

      const { body } = await http()
        .post(`/v1/admin/orders/${id}/cancel`)
        .set(signedInAs(manager))
        .send({ reason: 'El cliente lo pidió por teléfono', version: 1 })
        .expect(200);

      expect(body).toMatchObject({
        status: 'CANCELLED',
        version: 2,
        cancelledAt: expect.any(String),
        paymentDueAt: null,
      });
      expect(body.statusHistory[1]).toMatchObject({
        fromStatus: 'PENDING_PAYMENT',
        toStatus: 'CANCELLED',
        actorId: manager.id,
        reason: 'El cliente lo pidió por teléfono',
      });
      expect((await stockOf(shirt)).reserved).toBe(0);
      expect(
        await prisma.reservation.findFirstOrThrow({ where: { orderId: id } }),
      ).toMatchObject({ status: 'RELEASED' });
      expect(
        await prisma.auditLog.findFirstOrThrow({
          where: { action: 'orders.cancel', resourceId: id },
        }),
      ).toMatchObject({
        actorId: manager.id,
        reason: 'El cliente lo pidió por teléfono',
        changes: { status: { from: 'PENDING_PAYMENT', to: 'CANCELLED' } },
      });
    });

    it('answers 409 to an outdated version and to an order already cancelled', async () => {
      const shirt = await variant();
      const { id } = await guestOrder(shirt);
      const cancel = (version: number) =>
        http()
          .post(`/v1/admin/orders/${id}/cancel`)
          .set(signedInAs(manager))
          .send({ reason: 'Duplicado', version });
      await cancel(1).expect(200);

      const outdated = await cancel(1).expect(409);
      const again = await cancel(2).expect(409);

      expect(outdated.body).toMatchObject({
        type: '/problems/version-conflict',
        currentVersion: 2,
      });
      expect(again.body).toMatchObject({
        type: '/problems/invalid-state-transition',
        currentStatus: 'CANCELLED',
      });
    });

    it('restocks only with inventory.write, and only a PAID order (ADR-0052)', async () => {
      const shirt = await variant();
      const { id } = await guestOrder(shirt);
      const cancel = (user: AuthenticatedUser) =>
        http()
          .post(`/v1/admin/orders/${id}/cancel`)
          .set(signedInAs(user))
          .send({ reason: 'Duplicado', restock: true, version: 1 });

      await cancel(manager).expect(403);
      const notPaid = await cancel(
        staff('orders.read', 'orders.manage', 'inventory.write'),
      ).expect(409);

      expect(notPaid.body).toMatchObject({
        type: '/problems/restock-not-allowed',
        currentStatus: 'PENDING_PAYMENT',
      });
    });

    it('needs orders.manage and a reason', async () => {
      const shirt = await variant();
      const { id } = await guestOrder(shirt);

      await http()
        .post(`/v1/admin/orders/${id}/cancel`)
        .set(signedInAs(reader))
        .send({ reason: 'Duplicado', version: 1 })
        .expect(403);
      await http()
        .post(`/v1/admin/orders/${id}/cancel`)
        .set(signedInAs(manager))
        .send({ reason: ' ', version: 1 })
        .expect(400);
    });
  });

  describe('a captured payment (UC-ORD-09)', () => {
    it('marks the order paid when the payment was captured, and its stock leaves the warehouse', async () => {
      const shirt = await variant(5);
      const { id } = await guestOrder(shirt, 2);
      const capturedAt = new Date('2026-10-01T15:00:00.000Z');

      await capture(id, 29_900, capturedAt);
      await capture(id, 29_900, capturedAt);

      const { body } = await detail(id).expect(200);
      expect(body).toMatchObject({
        status: 'PAID',
        paidAt: capturedAt.toISOString(),
        paymentDueAt: null,
        version: 2,
      });
      expect(body.statusHistory[1]).toMatchObject({
        fromStatus: 'PENDING_PAYMENT',
        toStatus: 'PAID',
        actorId: null,
      });
      expect(await stockOf(shirt)).toMatchObject({ onHand: 3, reserved: 0 });
    });

    it('leaves the order as it is when the amount is not its total (BR-ORD-08)', async () => {
      const shirt = await variant();
      const { id } = await guestOrder(shirt);

      await capture(id, 19_899);

      expect((await detail(id).expect(200)).body).toMatchObject({
        status: 'PENDING_PAYMENT',
        paidAt: null,
        version: 1,
      });
    });

    it('reserves again for an expired order, or leaves it waiting for stock (ADR-0012)', async () => {
      const shirt = await variant(2);
      const stocked = await guestOrder(shirt);
      const short = await guestOrder(shirt);
      await expire(stocked.id, shirt);
      await expire(short.id, shirt);
      // Someone else bought one unit meanwhile.
      await prisma.stockItem.updateMany({
        where: { variantId: shirt },
        data: { onHand: 1 },
      });

      await capture(stocked.id, 19_900);
      await capture(short.id, 19_900);

      expect((await detail(stocked.id).expect(200)).body.status).toBe('PAID');
      // The order keeps the reservation the late payment opened and confirmed.
      const committed = await prisma.reservation.findFirstOrThrow({
        where: { orderId: stocked.id, status: 'COMMITTED' },
      });
      expect(
        (await prisma.order.findUniqueOrThrow({ where: { id: stocked.id } }))
          .reservationId,
      ).toBe(committed.id);
      expect((await detail(short.id).expect(200)).body).toMatchObject({
        status: 'AWAITING_MANUAL_FULFILLMENT',
        paidAt: expect.any(String),
      });
      expect(await stockOf(shirt)).toMatchObject({ onHand: 0, reserved: 0 });
    });

    it('keeps a cancelled order cancelled, waiting for its refund (ADR-0133)', async () => {
      const shirt = await variant();
      const { id } = await guestOrder(shirt);
      await prisma.payment.create({
        data: {
          id: newId(),
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
      await http()
        .post(`/v1/admin/orders/${id}/cancel`)
        .set(signedInAs(manager))
        .send({ reason: 'Duplicado', version: 1 })
        .expect(200);

      const capturedAt = new Date('2026-10-01T15:00:00.000Z');
      await capture(id, 19_900, capturedAt);
      await capture(id, 19_900, new Date('2026-10-01T16:00:00.000Z'));

      expect((await detail(id).expect(200)).body).toMatchObject({
        status: 'CANCELLED',
        paidAt: capturedAt.toISOString(),
        version: 3,
      });
      // Its refund started once, with the first event (ADR-0135).
      expect(
        await prisma.refund.findMany({
          select: { status: true, amount: true },
        }),
      ).toEqual([{ status: 'PENDING', amount: 19_900 }]);
      const notPending = await http()
        .get('/v1/admin/orders?hasPendingRefund=false')
        .set(signedInAs(reader))
        .expect(200);
      expect(notPending.body.meta.totalItems).toBe(0);
      const pending = await http()
        .get('/v1/admin/orders?hasPendingRefund=true')
        .set(signedInAs(reader))
        .expect(200);
      expect(
        pending.body.data.map(({ id: found }: { id: string }) => found),
      ).toEqual([id]);
    });
  });

  describe('retrying the fulfillment (UC-ORD-08)', () => {
    async function waitingOrder(): Promise<{ id: string; shirt: string }> {
      const shirt = await variant(1);
      const { id } = await guestOrder(shirt);
      await expire(id, shirt);
      await prisma.stockItem.updateMany({
        where: { variantId: shirt },
        data: { onHand: 0 },
      });
      await capture(id, 19_900);
      return { id, shirt };
    }

    const retry = (id: string, version: number) =>
      http()
        .post(`/v1/admin/orders/${id}/retry-fulfillment`)
        .set(signedInAs(manager))
        .send({ version });

    it('answers 409 insufficient-stock while there is no stock, and pays the order once there is', async () => {
      const { id, shirt } = await waitingOrder();

      const short = await retry(id, 2).expect(409);
      await prisma.stockItem.updateMany({
        where: { variantId: shirt },
        data: { onHand: 3 },
      });
      const { body } = await retry(id, 2).expect(200);

      expect(short.body).toMatchObject({
        type: '/problems/insufficient-stock',
        lines: [{ variantId: shirt, canFulfill: false }],
      });
      expect(body).toMatchObject({ status: 'PAID', version: 3 });
      expect(body.statusHistory.at(-1)).toMatchObject({
        fromStatus: 'AWAITING_MANUAL_FULFILLMENT',
        toStatus: 'PAID',
        actorId: manager.id,
      });
      expect(await stockOf(shirt)).toMatchObject({ onHand: 2, reserved: 0 });
      expect(
        await prisma.auditLog.count({
          where: { action: 'orders.retry-fulfillment', resourceId: id },
        }),
      ).toBe(1);
    });

    it('answers 409 invalid-state-transition for an order that does not wait for stock', async () => {
      const shirt = await variant();
      const { id } = await guestOrder(shirt);

      const response = await retry(id, 1).expect(409);

      expect(response.body).toMatchObject({
        type: '/problems/invalid-state-transition',
        currentStatus: 'PENDING_PAYMENT',
      });
    });
  });
});
