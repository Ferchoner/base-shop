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

/** The restock of an order (e2e, T-161, UC-INV-09, ADR-0052, ADR-0053, ADR-0142). */
describe('Restocks (e2e, T-161)', () => {
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
    await prisma.warehouse.deleteMany({ where: { id: { not: MAIN } } });
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
  const stocker = staff('orders.read', 'inventory.write');

  /** A published variant priced at $100.00, with 10 units. */
  async function variant(): Promise<string> {
    const productId = newId();
    const id = newId();
    await prisma.product.create({
      data: {
        id: productId,
        title: 'Camisa de lino',
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

  /** A verified customer with a paid order of these lines; it answers the IDs of the lines. */
  async function paidOrder(
    lines: { variantId: string; quantity: number }[],
  ): Promise<{
    customer: AuthenticatedUser;
    id: string;
    publicCode: string;
    lineIds: string[];
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
    await http()
      .post(`/v1/admin/orders/${id}/manual-capture`)
      .set(signedInAs(cashier))
      .send({ reference: 'Ticket 00452' })
      .expect(200);
    await idle();
    const order = await http()
      .get(`/v1/admin/orders/${id}`)
      .set(signedInAs(stocker))
      .expect(200);
    return {
      customer,
      id,
      publicCode,
      lineIds: order.body.lines.map(({ id: lineId }: { id: string }) => lineId),
    };
  }

  const restock = (
    orderId: string,
    body: object,
    key: string = randomUUID(),
    user = stocker,
  ) =>
    http()
      .post(`/v1/admin/orders/${orderId}/restocks`)
      .set(signedInAs(user))
      .set('Idempotency-Key', key)
      .send(body);

  const onHandOf = async (variantId: string) =>
    (await prisma.stockItem.findFirstOrThrow({ where: { variantId } })).onHand;

  it('brings back a cancelled order line by line, once per Idempotency-Key and never beyond what it sold', async () => {
    const [shirt, cap] = [await variant(), await variant()];
    const { customer, id, publicCode, lineIds } = await paidOrder([
      { variantId: shirt, quantity: 2 },
      { variantId: cap, quantity: 1 },
    ]);
    const [shirtLine, capLine] = lineIds;
    await http()
      .post(`/v1/admin/orders/${id}/cancel`)
      .set(signedInAs(manager))
      .send({ reason: 'Sin stock', version: 2 })
      .expect(200);
    const key = randomUUID();
    const first = {
      reasonCode: 'ORDER_CANCELLED',
      lines: [{ orderLineId: shirtLine.toUpperCase(), quantity: 1 }],
      note: '  Caja sin abrir  ',
    };

    const created = await restock(id, first, key).expect(201);
    const replayed = await restock(id, first, key).expect(201);
    const beyond = await restock(id, {
      reasonCode: 'ORDER_CANCELLED',
      lines: [{ orderLineId: shirtLine, quantity: 2 }],
    }).expect(409);
    const rest = await restock(id, {
      reasonCode: 'ORDER_CANCELLED',
      lines: [
        { orderLineId: shirtLine, quantity: 1 },
        { orderLineId: capLine, quantity: 1 },
      ],
    }).expect(201);

    expect(created.body).toEqual({
      movements: [
        {
          id: expect.any(String),
          stockItemId: expect.any(String),
          type: 'RESTOCK',
          quantity: 1,
          onHandAfter: 9,
          reasonCode: 'ORDER_CANCELLED',
          note: 'Caja sin abrir',
          orderId: id,
          orderLineId: shirtLine,
          actorId: stocker.id,
          createdAt: expect.any(String),
        },
      ],
    });
    expect(replayed.body).toEqual(created.body);
    expect(beyond.body).toMatchObject({
      type: '/problems/restock-not-allowed',
      lines: [{ orderLineId: shirtLine, sold: 2, restocked: 1, requested: 2 }],
    });
    expect(
      rest.body.movements.map(
        ({ orderLineId, onHandAfter }: Record<string, unknown>) => [
          orderLineId,
          onHandAfter,
        ],
      ),
    ).toEqual([
      [shirtLine, 10],
      [capLine, 10],
    ]);
    expect([await onHandOf(shirt), await onHandOf(cap)]).toEqual([10, 10]);
    const audits = await prisma.auditLog.findMany({
      where: { action: 'orders.restock' },
      orderBy: { occurredAt: 'asc' },
    });
    expect(
      audits.map(({ actorId, resourceId, reason }) => [
        actorId,
        resourceId,
        reason,
      ]),
    ).toEqual([
      [stocker.id, id, 'Caja sin abrir'],
      [stocker.id, id, null],
    ]);
    const mine = await http()
      .get(`/v1/me/orders/${publicCode}`)
      .set(signedInAs(customer))
      .expect(200);
    expect(mine.body.lines[0]).not.toHaveProperty('id');
  });

  it('brings back the goods of a returned shipment, and nothing before they come back (ADR-0053)', async () => {
    const shirt = await variant();
    const { id, lineIds } = await paidOrder([
      { variantId: shirt, quantity: 1 },
    ]);
    const returned = {
      reasonCode: 'SHIPMENT_RETURNED',
      lines: [{ orderLineId: lineIds[0], quantity: 1 }],
    };
    const early = await restock(id, returned).expect(409);
    const { body: shipments } = await http()
      .get(`/v1/admin/shipping/shipments?orderId=${id}`)
      .set(signedInAs(shipper))
      .expect(200);
    const shipmentId = shipments.data[0].id as string;
    for (const [action, version] of [
      ['dispatch', 1],
      ['delivery-failure', 2],
      ['return', 3],
    ] as const) {
      await http()
        .post(`/v1/admin/shipping/shipments/${shipmentId}/${action}`)
        .set(signedInAs(shipper))
        .send(
          action === 'dispatch' ? { ownDelivery: true, version } : { version },
        )
        .expect(200);
    }
    await idle();

    const cancelledReason = await restock(id, {
      ...returned,
      reasonCode: 'ORDER_CANCELLED',
    }).expect(409);
    const restocked = await restock(id, returned).expect(201);

    expect(early.body).toMatchObject({
      type: '/problems/invalid-state-transition',
      currentStatus: 'PENDING',
    });
    expect(cancelledReason.body).toMatchObject({
      type: '/problems/invalid-state-transition',
      currentStatus: 'SHIPPED',
    });
    expect(restocked.body.movements).toEqual([
      expect.objectContaining({
        reasonCode: 'SHIPMENT_RETURNED',
        quantity: 1,
        onHandAfter: 10,
      }),
    ]);
  });

  it('needs inventory.write, an Idempotency-Key, valid lines of the order and an order that exists', async () => {
    const shirt = await variant();
    const { id, lineIds } = await paidOrder([
      { variantId: shirt, quantity: 1 },
    ]);
    await http()
      .post(`/v1/admin/orders/${id}/cancel`)
      .set(signedInAs(manager))
      .send({ reason: 'Sin stock', version: 2 })
      .expect(200);
    const valid = {
      reasonCode: 'ORDER_CANCELLED',
      lines: [{ orderLineId: lineIds[0], quantity: 1 }],
    };

    await restock(id, valid, randomUUID(), manager).expect(403);
    const missingKey = await http()
      .post(`/v1/admin/orders/${id}/restocks`)
      .set(signedInAs(stocker))
      .send(valid)
      .expect(400);
    for (const invalid of [
      { ...valid, reasonCode: 'DAMAGED' },
      { ...valid, lines: [] },
      { ...valid, lines: [valid.lines[0], valid.lines[0]] },
      { ...valid, lines: [{ orderLineId: lineIds[0], quantity: 0 }] },
      { ...valid, lines: [{ orderLineId: 'x', quantity: 1 }] },
      { ...valid, note: 'x'.repeat(501) },
      { reasonCode: 'ORDER_CANCELLED' },
    ]) {
      await restock(id, invalid).expect(400);
    }
    const unknownLine = await restock(id, {
      ...valid,
      lines: [{ orderLineId: newId(), quantity: 1 }],
    }).expect(400);
    await restock(newId(), valid).expect(404);

    expect(missingKey.body.type).toBe('/problems/idempotency-key-missing');
    expect(unknownLine.body.errors).toEqual([
      expect.objectContaining({
        field: 'lines[0].orderLineId',
        code: 'orderLine',
      }),
    ]);
    expect(
      await prisma.stockMovement.count({ where: { type: 'RESTOCK' } }),
    ).toBe(0);
  });

  it('brings the goods back to the warehouse they left, or to the active warehouseId the staff names (ADR-0160)', async () => {
    const north = newId();
    await prisma.warehouse.create({
      data: {
        id: north,
        code: 'NORTE',
        name: 'Almacén norte',
        status: 'INACTIVE',
        priority: 2,
      },
    });
    const shirt = await variant();
    const { id, lineIds } = await paidOrder([
      { variantId: shirt, quantity: 2 },
    ]);
    await http()
      .post(`/v1/admin/orders/${id}/cancel`)
      .set(signedInAs(manager))
      .send({ reason: 'Sin stock', version: 2 })
      .expect(200);
    const line = { orderLineId: lineIds[0], quantity: 1 };

    const inactive = await restock(id, {
      reasonCode: 'ORDER_CANCELLED',
      lines: [line],
      warehouseId: north,
    }).expect(404);
    const invalid = await restock(id, {
      reasonCode: 'ORDER_CANCELLED',
      lines: [line],
      warehouseId: 'norte',
    }).expect(400);
    await prisma.warehouse.update({
      where: { id: north },
      data: { status: 'ACTIVE' },
    });
    const named = await restock(id, {
      reasonCode: 'ORDER_CANCELLED',
      lines: [line],
      warehouseId: north,
    }).expect(201);
    const origin = await restock(id, {
      reasonCode: 'ORDER_CANCELLED',
      lines: [line],
    }).expect(201);

    const warehouseOf = async (stockItemId: string) =>
      (await prisma.stockItem.findUniqueOrThrow({ where: { id: stockItemId } }))
        .warehouseId;
    expect(inactive.body.type).toBe('/problems/not-found');
    expect(invalid.body.errors).toEqual([
      expect.objectContaining({ field: 'warehouseId', code: 'isUuid' }),
    ]);
    expect(await warehouseOf(named.body.movements[0].stockItemId)).toBe(north);
    expect(await warehouseOf(origin.body.movements[0].stockItemId)).toBe(MAIN);
  });
});
