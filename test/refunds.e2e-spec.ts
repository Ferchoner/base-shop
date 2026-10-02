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
  neighborhood: 'Centro',
  postalCode: '58000',
  stateCode: '16',
  municipalityCode: '16053',
};

const mxn = (amount: number) => ({ amount, currency: 'MXN' });

/** Refunds over HTTP (T-190 part b, UC-PAY-03 and 06, ADR-0051, ADR-0135). */
describe('Refunds (e2e, T-190)', () => {
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
  ): Promise<{ customer: AuthenticatedUser; id: string; publicCode: string }> {
    const userId = newId();
    await prisma.user.create({
      data: {
        id: userId,
        type: 'CUSTOMER',
        email: `${userId}@example.com`,
        firstNames: 'Ana',
        lastNames: 'Pérez',
        passwordHash: 'not-a-real-hash',
        emailVerifiedAt: new Date(),
      },
    });
    const customer: AuthenticatedUser = {
      id: userId,
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
    const publicCode = body.publicCode as string;
    const { id } = await prisma.order.findFirstOrThrow({
      where: { publicCode: publicCode.replace('-', '') },
    });
    return { customer, id, publicCode };
  }

  const detail = (orderId: string) =>
    http().get(`/v1/admin/orders/${orderId}`).set(signedInAs(cashier));

  const paymentOf = (paymentId: string) =>
    http().get(`/v1/admin/payments/${paymentId}`).set(signedInAs(cashier));

  /** The store registers the payment, and the order becomes paid in the background. */
  async function paid(orderId: string): Promise<string> {
    const { body } = await http()
      .post(`/v1/admin/orders/${orderId}/manual-capture`)
      .set(signedInAs(cashier))
      .send({ reference: 'Ticket 00452' })
      .expect(200);
    await idle();
    return body.payment.id as string;
  }

  const cancel = (orderId: string, version: number, body: object = {}) =>
    http()
      .post(`/v1/admin/orders/${orderId}/cancel`)
      .set(signedInAs(manager))
      .send({ reason: 'Sin stock', version, ...body });

  const refund = (paymentId: string, version: number, body: object = {}) =>
    http()
      .post(`/v1/admin/payments/${paymentId}/refunds/manual`)
      .set(signedInAs(cashier))
      .send({
        reference: 'Devolución 00087',
        note: 'Devuelto en efectivo',
        version,
        ...body,
      });

  /** A paid order, cancelled: its payment waits for its refund. */
  async function refunding(): Promise<{ orderId: string; paymentId: string }> {
    const { id } = await guestOrder(await variant());
    const paymentId = await paid(id);
    await cancel(id, 2).expect(200);
    return { orderId: id, paymentId };
  }

  const pendingRefunds = async () =>
    (
      await http()
        .get('/v1/admin/orders?hasPendingRefund=true')
        .set(signedInAs(cashier))
        .expect(200)
    ).body.data.map(({ id }: { id: string }) => id);

  describe('cancelling an order (UC-PAY-03)', () => {
    it('starts the refund of a paid order in the cancellation, without touching the stock that left', async () => {
      const shirt = await variant(5);
      const { id } = await guestOrder(shirt);
      const paymentId = await paid(id);

      const { body } = await cancel(id, 2).expect(200);

      expect(body).toMatchObject({
        status: 'CANCELLED',
        paidAt: expect.any(String),
        cancelledAt: expect.any(String),
        refundedAt: null,
        payment: {
          id: paymentId,
          status: 'CAPTURED',
          refundedAmount: mxn(0),
          refunds: [
            {
              id: expect.any(String),
              amount: mxn(19_900),
              status: 'PENDING',
              createdAt: expect.any(String),
              completedAt: null,
            },
          ],
        },
      });
      expect(
        await prisma.stockItem.findFirstOrThrow({
          where: { variantId: shirt },
        }),
      ).toMatchObject({ onHand: 4, reserved: 0 });
      expect(await pendingRefunds()).toEqual([id]);
    });

    it('starts the refund of a paid order waiting for stock', async () => {
      const shirt = await variant(1);
      const { id } = await guestOrder(shirt);
      // The order expired, and its stock was sold before the late payment arrived.
      await prisma.order.update({
        where: { id },
        data: { status: 'EXPIRED', expiredAt: new Date() },
      });
      await prisma.reservation.updateMany({
        where: { orderId: id },
        data: { status: 'EXPIRED' },
      });
      await prisma.stockItem.updateMany({
        where: { variantId: shirt },
        data: { onHand: 0, reserved: 0 },
      });
      await paid(id);
      const waiting = await detail(id).expect(200);
      expect(waiting.body.status).toBe('AWAITING_MANUAL_FULFILLMENT');

      const { body } = await cancel(id, waiting.body.version).expect(200);

      expect(body).toMatchObject({
        status: 'CANCELLED',
        payment: { status: 'CAPTURED', refunds: [{ status: 'PENDING' }] },
      });
    });

    it('cancels the payment the buyer started of an unpaid order, and releases its stock', async () => {
      const shirt = await variant(5);
      const { id, publicCode, cartId } = await guestOrder(shirt);
      const started = await http()
        .post(`/v1/orders/${publicCode}/payments`)
        .set('Idempotency-Key', randomUUID())
        .send({ cartId, provider: 'MANUAL' })
        .expect(201);

      const { body } = await cancel(id, 1).expect(200);

      expect(body).toMatchObject({
        status: 'CANCELLED',
        paidAt: null,
        payment: { status: 'CANCELLED', refunds: [] },
      });
      expect(
        (await paymentOf(started.body.paymentId).expect(200)).body,
      ).toMatchObject({ status: 'CANCELLED', version: 2 });
      expect(
        await prisma.stockItem.findFirstOrThrow({
          where: { variantId: shirt },
        }),
      ).toMatchObject({ onHand: 5, reserved: 0 });
      expect(await pendingRefunds()).toEqual([]);
    });

    it('starts the refund of a payment captured after the cancellation (ADR-0133)', async () => {
      const { id } = await guestOrder(await variant());
      await cancel(id, 1).expect(200);
      // The provider captured it anyway.
      const paymentId = newId();
      await prisma.payment.create({
        data: {
          id: paymentId,
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
      const captured: PaymentCaptured = {
        ...eventMetadata('PaymentCaptured', new Date()),
        paymentId,
        orderId: id,
        amount: { amount: 19_900, currency: 'MXN' },
      };

      await app
        .get(ClsService)
        .run(async () => app.get(DomainEventPublisher).publish(captured));
      await idle();

      const { body } = await paymentOf(paymentId).expect(200);
      expect(body).toMatchObject({
        status: 'CAPTURED',
        refunds: [{ status: 'PENDING', amount: mxn(19_900) }],
      });
      await refund(paymentId, body.version).expect(200);
      await idle();
      expect((await detail(id).expect(200)).body.status).toBe('REFUNDED');
    });

    it('brings the stock of a paid order back when cancelling it with its restock (ADR-0052, ADR-0142)', async () => {
      const shirt = await variant();
      const { id } = await guestOrder(shirt);
      await paid(id);

      const response = await http()
        .post(`/v1/admin/orders/${id}/cancel`)
        .set(signedInAs(staff('orders.manage', 'inventory.write')))
        .send({ reason: 'Sin stock', version: 2, restock: true })
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'CANCELLED',
        payment: { refunds: [{ status: 'PENDING' }] },
      });
      expect(
        (
          await prisma.stockItem.findFirstOrThrow({
            where: { variantId: shirt },
          })
        ).onHand,
      ).toBe(5);
      expect(
        await prisma.stockMovement.findMany({
          where: { type: 'RESTOCK' },
          select: { quantity: true, reasonCode: true, note: true },
        }),
      ).toEqual([
        { quantity: 1, reasonCode: 'ORDER_CANCELLED', note: 'Sin stock' },
      ]);
    });
  });

  describe('registering a refund made outside the system (UC-PAY-06)', () => {
    it('completes the refund, audits it, and the order is refunded in the background', async () => {
      const shirt = await variant();
      const { customer, id, publicCode } = await customerOrder(shirt);
      const paymentId = await paid(id);
      await cancel(id, 2).expect(200);
      const before = await paymentOf(paymentId).expect(200);

      const { body } = await refund(paymentId, before.body.version).expect(200);
      await idle();

      expect(body).toMatchObject({
        id: paymentId,
        status: 'REFUNDED',
        capturedAmount: mxn(19_900),
        refundedAmount: mxn(19_900),
        version: before.body.version + 1,
        refunds: [
          {
            id: before.body.refunds[0].id,
            amount: mxn(19_900),
            status: 'COMPLETED',
            providerRefundId: 'Devolución 00087',
            registeredBy: cashier.id,
            createdAt: before.body.refunds[0].createdAt,
            completedAt: expect.any(String),
          },
        ],
      });
      const { completedAt } = body.refunds[0];
      const order = await detail(id).expect(200);
      expect(order.body).toMatchObject({
        status: 'REFUNDED',
        refundedAt: completedAt,
        payment: { status: 'REFUNDED', refunds: [{ status: 'COMPLETED' }] },
      });
      expect(order.body.statusHistory.at(-1)).toEqual({
        fromStatus: 'CANCELLED',
        toStatus: 'REFUNDED',
        actorId: null,
        reason: null,
        occurredAt: expect.any(String),
      });
      expect(await pendingRefunds()).toEqual([]);
      expect(
        await prisma.auditLog.findFirstOrThrow({
          where: { action: 'payments.manual-refund' },
        }),
      ).toMatchObject({
        actorId: cashier.id,
        resourceType: 'payment',
        resourceId: paymentId,
        reason: 'Devuelto en efectivo',
        changes: { status: { from: 'CAPTURED', to: 'REFUNDED' } },
      });
      const mine = await http()
        .get(`/v1/me/orders/${publicCode}`)
        .set(signedInAs(customer))
        .expect(200);
      expect(mine.body).toMatchObject({
        status: 'REFUNDED',
        refundedAt: completedAt,
        payment: { provider: 'MANUAL', status: 'REFUNDED' },
      });
    });

    it('audits without a note when it is blank', async () => {
      const { paymentId } = await refunding();
      const { body } = await paymentOf(paymentId).expect(200);

      await refund(paymentId, body.version, { note: '  ' }).expect(200);

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'payments.manual-refund' },
      });
      expect(audit.reason).toBeNull();
    });

    it('answers 409 for a payment read at another version or without a pending refund', async () => {
      const { orderId, paymentId } = await refunding();
      const { body } = await paymentOf(paymentId).expect(200);
      const notCancelled = await guestOrder(await variant());
      const captured = await paymentOf(await paid(notCancelled.id)).expect(200);

      const outdated = await refund(paymentId, body.version - 1).expect(409);
      const withoutRefund = await refund(
        captured.body.id,
        captured.body.version,
      ).expect(409);
      await refund(paymentId, body.version).expect(200);
      const again = await refund(paymentId, body.version + 1).expect(409);

      expect(outdated.body).toMatchObject({
        type: '/problems/version-conflict',
        currentVersion: body.version,
      });
      expect(withoutRefund.body).toMatchObject({
        type: '/problems/invalid-state-transition',
        currentStatus: 'CAPTURED',
      });
      expect(again.body).toMatchObject({
        type: '/problems/invalid-state-transition',
        currentStatus: 'REFUNDED',
      });
      await idle();
      expect((await detail(orderId).expect(200)).body.status).toBe('REFUNDED');
      expect(
        await prisma.auditLog.count({
          where: { action: 'payments.manual-refund' },
        }),
      ).toBe(1);
    });

    it('restocks nothing: the stock of the order comes back apart (ADR-0142)', async () => {
      const { paymentId } = await refunding();
      const { body } = await paymentOf(paymentId).expect(200);

      const rejected = await http()
        .post(`/v1/admin/payments/${paymentId}/refunds/manual`)
        .set(signedInAs(staff('payments.manage', 'inventory.write')))
        .send({
          reference: 'Devolución 00087',
          restock: true,
          version: body.version,
        })
        .expect(400);

      expect(rejected.body.errors).toEqual([
        expect.objectContaining({
          field: 'restock',
          code: 'whitelistValidation',
        }),
      ]);
      expect((await paymentOf(paymentId).expect(200)).body.status).toBe(
        'CAPTURED',
      );
    });

    it('needs payments.manage, a receipt, a version and a payment that exists', async () => {
      const { paymentId } = await refunding();
      const { body } = await paymentOf(paymentId).expect(200);

      await http()
        .post(`/v1/admin/payments/${paymentId}/refunds/manual`)
        .set(signedInAs(manager))
        .send({ reference: 'Devolución 00087', version: body.version })
        .expect(403);
      for (const invalid of [
        { reference: ' ' },
        { reference: 'x'.repeat(101) },
        { note: 'x'.repeat(501) },
        { version: 0 },
        { version: undefined },
      ]) {
        await refund(paymentId, body.version, invalid).expect(400);
      }
      for (const missing of [newId(), 'no-es-un-id']) {
        const response = await refund(missing, body.version).expect(404);
        expect(response.body.type).toBe('/problems/not-found');
      }
      expect((await paymentOf(paymentId).expect(200)).body.status).toBe(
        'CAPTURED',
      );
    });
  });
});
