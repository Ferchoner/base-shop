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
  neighborhood: 'Centro',
  postalCode: '58000',
  stateCode: '16',
  municipalityCode: '16053',
};

/** The shipment of a paid order (e2e, T-195 part a, UC-SHI-03, 04 and 08, ADR-0140). */
describe('Shipments (e2e, T-195)', () => {
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

  const staff = (...permissions: PermissionCode[]): AuthenticatedUser => ({
    id: newId(),
    type: 'STAFF',
    permissions,
    mustChangePassword: false,
    sessionId: newId(),
  });
  const cashier = staff('orders.read', 'payments.manage');
  const manager = staff('orders.read', 'orders.manage');
  const shipper = staff('shipping.manage');

  /** A published variant priced at $100.00, with 10 units. */
  async function variant(title = 'Camisa de lino'): Promise<string> {
    const productId = newId();
    const id = newId();
    await prisma.product.create({
      data: {
        id: productId,
        title,
        slug: `producto-${productId.slice(-12)}`,
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

  /** A verified customer with an order of these lines. */
  async function customerOrder(
    lines: { variantId: string; quantity: number }[],
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
    for (const [index, line] of lines.entries()) {
      await http()
        .post('/v1/me/cart/lines')
        .set(signedInAs(customer))
        .send(line)
        .expect(index === 0 ? 201 : 200);
    }
    const { body } = await http()
      .post('/v1/me/orders')
      .set(signedInAs(customer))
      .set('Idempotency-Key', randomUUID())
      .send({
        shippingAddress: ADDRESS,
        expectedTotal: lines.reduce(
          (sum, { quantity }) => sum + quantity * 10_000,
          9_900,
        ),
      })
      .expect(201);
    const publicCode = body.publicCode as string;
    const { id } = await prisma.order.findFirstOrThrow({
      where: { publicCode: publicCode.replace('-', '') },
    });
    return { customer, id, publicCode };
  }

  /** The store registers the payment, and the order becomes paid in the background. */
  async function paid(orderId: string): Promise<void> {
    await http()
      .post(`/v1/admin/orders/${orderId}/manual-capture`)
      .set(signedInAs(cashier))
      .send({ reference: 'Ticket 00452' })
      .expect(200);
    await idle();
  }

  const list = (query = '', user = shipper) =>
    http().get(`/v1/admin/shipping/shipments?${query}`).set(signedInAs(user));

  const shipmentOf = async (orderId: string) =>
    (await list(`orderId=${orderId}&status=PENDING,CANCELLED`).expect(200)).body
      .data[0];

  const recordTracking = (shipmentId: string, body: object) =>
    http()
      .patch(`/v1/admin/shipping/shipments/${shipmentId}`)
      .set(signedInAs(shipper))
      .send(body);

  it('creates the shipment of a paid order, which the staff lists as pending and the order shows', async () => {
    const [shirt, cap] = [await variant(), await variant('Gorra')];
    const { customer, id, publicCode } = await customerOrder([
      { variantId: shirt, quantity: 2 },
      { variantId: cap, quantity: 1 },
    ]);
    const unpaid = await customerOrder([{ variantId: shirt, quantity: 1 }]);

    await paid(id);

    const { body } = await list().expect(200);
    expect(body.meta.totalItems).toBe(1);
    const [shipment] = body.data;
    expect(shipment).toEqual({
      id: expect.any(String),
      orderId: id,
      orderCode: publicCode,
      warehouseId: MAIN,
      status: 'PENDING',
      destination: {
        recipientName: 'María López Hernández',
        phone: '4431234567',
        street: 'Av. Madero Poniente',
        exteriorNumber: '123',
        interiorNumber: null,
        neighborhood: 'Centro',
        postalCode: '58000',
        stateCode: '16',
        stateName: 'Michoacán de Ocampo',
        municipalityCode: '16053',
        municipalityName: 'Morelia',
        city: null,
        references: null,
        country: 'MX',
      },
      items: [
        {
          orderLineId: expect.any(String),
          sku: expect.stringMatching(/^SKU-/),
          productName: 'Camisa de lino',
          quantity: 2,
        },
        {
          orderLineId: expect.any(String),
          sku: expect.stringMatching(/^SKU-/),
          productName: 'Gorra',
          quantity: 1,
        },
      ],
      carrierName: null,
      trackingNumber: null,
      ownDelivery: false,
      dispatchedAt: null,
      deliveredAt: null,
      failedAt: null,
      returnedAt: null,
      cancelledAt: null,
      version: 1,
      createdAt: expect.any(String),
    });
    expect(
      (
        await http()
          .get(`/v1/admin/shipping/shipments/${shipment.id}`)
          .set(signedInAs(shipper))
          .expect(200)
      ).body,
    ).toEqual(shipment);
    const shown = {
      status: 'PENDING',
      carrierName: null,
      trackingNumber: null,
      ownDelivery: false,
      dispatchedAt: null,
      deliveredAt: null,
    };
    const admin = await http()
      .get(`/v1/admin/orders/${id}`)
      .set(signedInAs(manager))
      .expect(200);
    const mine = await http()
      .get(`/v1/me/orders/${publicCode}`)
      .set(signedInAs(customer))
      .expect(200);
    const unpaidView = await http()
      .get(`/v1/me/orders/${unpaid.publicCode}`)
      .set(signedInAs(unpaid.customer))
      .expect(200);
    expect(mine.body.shipment).toEqual(shown);
    expect(admin.body.shipment).toEqual({
      ...shown,
      id: shipment.id,
      version: 1,
    });
    expect(unpaidView.body.shipment).toBeNull();
  });

  it('records the carrier and the tracking number, audited, and the order shows them', async () => {
    const { customer, id, publicCode } = await customerOrder([
      { variantId: await variant(), quantity: 1 },
    ]);
    await paid(id);
    const shipment = await shipmentOf(id);

    const { body } = await recordTracking(shipment.id, {
      carrierName: ' Estafeta ',
      trackingNumber: 'EST-0001',
      version: 1,
    }).expect(200);
    const same = await recordTracking(shipment.id, {
      carrierName: 'Estafeta',
      trackingNumber: 'EST-0001',
      version: 2,
    }).expect(200);
    const outdated = await recordTracking(shipment.id, {
      carrierName: 'DHL',
      trackingNumber: 'DHL-0002',
      version: 1,
    }).expect(409);

    expect(body).toMatchObject({
      carrierName: 'Estafeta',
      trackingNumber: 'EST-0001',
      version: 2,
    });
    expect(same.body.version).toBe(2);
    expect(outdated.body).toMatchObject({
      type: '/problems/version-conflict',
      currentVersion: 2,
    });
    const audits = await prisma.auditLog.findMany({
      where: { action: 'shipments.update' },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorId: shipper.id,
      resourceType: 'shipment',
      resourceId: shipment.id,
      changes: {
        carrierName: { from: null, to: 'Estafeta' },
        trackingNumber: { from: null, to: 'EST-0001' },
      },
    });
    const mine = await http()
      .get(`/v1/me/orders/${publicCode}`)
      .set(signedInAs(customer))
      .expect(200);
    expect(mine.body.shipment).toMatchObject({
      carrierName: 'Estafeta',
      trackingNumber: 'EST-0001',
    });
  });

  it('cancels the shipment with its paid order, and a cancelled shipment takes no tracking (ADR-0140)', async () => {
    const { id } = await customerOrder([
      { variantId: await variant(), quantity: 1 },
    ]);
    await paid(id);

    const cancelled = await http()
      .post(`/v1/admin/orders/${id}/cancel`)
      .set(signedInAs(manager))
      .send({ reason: 'Sin stock', version: 2 })
      .expect(200);

    const shipment = await shipmentOf(id);
    expect(shipment).toMatchObject({
      status: 'CANCELLED',
      cancelledAt: expect.any(String),
      version: 2,
    });
    expect(cancelled.body.shipment).toMatchObject({
      id: shipment.id,
      status: 'CANCELLED',
      version: 2,
    });
    expect((await list().expect(200)).body.meta.totalItems).toBe(0);
    const rejected = await recordTracking(shipment.id, {
      carrierName: 'Estafeta',
      trackingNumber: 'EST-0001',
      version: shipment.version,
    }).expect(409);
    expect(rejected.body).toMatchObject({
      type: '/problems/invalid-state-transition',
      currentStatus: 'CANCELLED',
    });
  });

  it('lists by order, code or tracking number and date, oldest first unless sorted otherwise', async () => {
    const shirt = await variant();
    const first = await customerOrder([{ variantId: shirt, quantity: 1 }]);
    const second = await customerOrder([{ variantId: shirt, quantity: 1 }]);
    await paid(first.id);
    await paid(second.id);
    const tracked = await shipmentOf(second.id);
    await recordTracking(tracked.id, {
      carrierName: 'Estafeta',
      trackingNumber: 'EST-0001',
      version: 1,
    }).expect(200);
    const codes = async (query: string) =>
      (await list(query).expect(200)).body.data.map(
        ({ orderCode }: { orderCode: string }) => orderCode,
      );
    const tomorrow = new Date(Date.now() + 86_400_000)
      .toISOString()
      .slice(0, 10);

    expect(await codes('')).toEqual([first.publicCode, second.publicCode]);
    expect(await codes('sort=-createdAt')).toEqual([
      second.publicCode,
      first.publicCode,
    ]);
    expect(
      await codes(`q=${first.publicCode.replace('-', '').toLowerCase()}`),
    ).toEqual([first.publicCode]);
    expect(await codes('q=est-0001')).toEqual([second.publicCode]);
    expect(await codes(`orderId=${second.id}`)).toEqual([second.publicCode]);
    expect(await codes(`createdFrom=${tomorrow}`)).toEqual([]);
  });

  it('needs shipping.manage, valid input and a shipment that exists', async () => {
    const { id } = await customerOrder([
      { variantId: await variant(), quantity: 1 },
    ]);
    await paid(id);
    const shipment = await shipmentOf(id);

    await list('', staff('orders.read')).expect(403);
    await list('status=SENT').expect(400);
    await list('sort=amount').expect(400);
    for (const missing of [newId(), 'no-es-un-id']) {
      await http()
        .get(`/v1/admin/shipping/shipments/${missing}`)
        .set(signedInAs(shipper))
        .expect(404);
    }
    for (const invalid of [
      { carrierName: ' ', trackingNumber: 'EST-0001', version: 1 },
      { carrierName: 'Estafeta', trackingNumber: 'x'.repeat(101), version: 1 },
      { carrierName: 'Estafeta', trackingNumber: 'EST-0001' },
      { carrierName: 'Estafeta', trackingNumber: 'EST-0001', version: 0 },
    ]) {
      await recordTracking(shipment.id, invalid).expect(400);
    }
    expect((await shipmentOf(id)).version).toBe(1);
  });
});
