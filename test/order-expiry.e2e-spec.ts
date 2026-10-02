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

/** Unpaid orders that expire, seen over HTTP (T-230, UC-ORD-10, UC-INV-08, ADR-0136). */
describe('Expiration of unpaid orders (e2e, T-230)', () => {
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
  const expireDue = () =>
    app.get(ClsService).run(() => app.get(OrderExpiry).expireDue());

  const staff = (...permissions: PermissionCode[]): AuthenticatedUser => ({
    id: newId(),
    type: 'STAFF',
    permissions,
    mustChangePassword: false,
    sessionId: newId(),
  });
  const cashier = staff('orders.read', 'payments.manage');
  const manager = staff('orders.read', 'orders.manage');

  /** A published variant priced at $100.00, with 5 units. */
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
      data: { id: newId(), variantId: id, warehouseId: MAIN, onHand: 5 },
    });
    return id;
  }

  /** A verified customer with an order of one unit, whose payment they started. */
  async function customerOrder(variantId: string): Promise<{
    customer: AuthenticatedUser;
    id: string;
    publicCode: string;
  }> {
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
    await startPayment(customer, publicCode).expect(201);
    const { id } = await prisma.order.findFirstOrThrow({
      where: { publicCode: publicCode.replace('-', '') },
    });
    return { customer, id, publicCode };
  }

  const startPayment = (customer: AuthenticatedUser, publicCode: string) =>
    http()
      .post(`/v1/me/orders/${publicCode}/payments`)
      .set(signedInAs(customer))
      .set('Idempotency-Key', randomUUID())
      .send({ provider: 'MANUAL' });

  /** Its payment was due a second ago. */
  const due = (orderId: string) =>
    prisma.order.update({
      where: { id: orderId },
      data: { paymentDueAt: new Date(Date.now() - 1_000) },
    });

  const stockOf = (variantId: string) =>
    prisma.stockItem.findFirstOrThrow({
      where: { variantId },
      select: { onHand: true, reserved: true },
    });

  it('expires an unpaid order when its payment is due: everyone sees it, its stock is back, and the store can still take its payment (ADR-0012)', async () => {
    const shirt = await variant();
    const { customer, id, publicCode } = await customerOrder(shirt);
    await due(id);

    expect(await expireDue()).toEqual({ expired: 1, failed: 0 });

    const { body } = await http()
      .get(`/v1/admin/orders/${id}`)
      .set(signedInAs(cashier))
      .expect(200);
    expect(body).toMatchObject({
      status: 'EXPIRED',
      expiredAt: expect.any(String),
      paymentDueAt: null,
      version: 2,
      payment: { status: 'PENDING' },
    });
    expect(body.statusHistory.at(-1)).toEqual({
      fromStatus: 'PENDING_PAYMENT',
      toStatus: 'EXPIRED',
      actorId: null,
      reason: null,
      occurredAt: body.expiredAt,
    });
    const mine = await http()
      .get(`/v1/me/orders/${publicCode}`)
      .set(signedInAs(customer))
      .expect(200);
    expect(mine.body).toMatchObject({
      status: 'EXPIRED',
      expiredAt: body.expiredAt,
      paymentDueAt: null,
      payment: { provider: 'MANUAL', status: 'PENDING' },
    });
    expect(await stockOf(shirt)).toEqual({ onHand: 5, reserved: 0 });

    // The buyer cannot start it again, nor the staff cancel it; the store can take its late payment.
    const again = await startPayment(customer, publicCode).expect(409);
    const cancelled = await http()
      .post(`/v1/admin/orders/${id}/cancel`)
      .set(signedInAs(manager))
      .send({ reason: 'Duplicado', version: 2 })
      .expect(409);
    await http()
      .post(`/v1/admin/orders/${id}/manual-capture`)
      .set(signedInAs(cashier))
      .send({ reference: 'Ticket 00452' })
      .expect(200);
    await idle();

    expect(again.body).toMatchObject({
      type: '/problems/invalid-state-transition',
      currentStatus: 'EXPIRED',
    });
    expect(cancelled.body.currentStatus).toBe('EXPIRED');
    expect(
      (await http().get(`/v1/admin/orders/${id}`).set(signedInAs(cashier))).body
        .status,
    ).toBe('PAID');
    expect(await stockOf(shirt)).toEqual({ onHand: 4, reserved: 0 });
  });

  it('leaves an order whose payment is not due yet, and expires each order once', async () => {
    const shirt = await variant();
    const pending = await customerOrder(shirt);
    const expired = await customerOrder(shirt);
    await due(expired.id);

    expect(await expireDue()).toEqual({ expired: 1, failed: 0 });
    expect(await expireDue()).toEqual({ expired: 0, failed: 0 });

    expect(
      await prisma.order.findMany({
        select: { id: true, status: true, version: true },
        orderBy: { placedAt: 'asc' },
      }),
    ).toEqual([
      { id: pending.id, status: 'PENDING_PAYMENT', version: 1 },
      { id: expired.id, status: 'EXPIRED', version: 2 },
    ]);
    expect(await stockOf(shirt)).toEqual({ onHand: 5, reserved: 1 });
  });
});
