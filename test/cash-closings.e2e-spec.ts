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
import {
  mexicoDateOf,
  newId,
  type PermissionCode,
} from '../src/shared-kernel/index.js';
import {
  signedInAs,
  useTestAuthentication,
} from './support/test-authentication.js';

/** The list its migration creates (ADR-0125). */
const DEFAULT_LIST = '01a0f4f2-bb5f-770a-a269-105d21861fe0';
const CLOSINGS = '/v1/admin/cash-closings';

const mxn = (amount: number) => ({ amount, currency: 'MXN' });

/** The cash closing of each store over HTTP (T-183, UC-ORD-16 and 17, ADR-0171). */
describe('Cash closings (e2e, T-183)', () => {
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
  });

  afterEach(async () => {
    await app.get(DomainEventDispatcher).whenIdle();
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { action: { startsWith: 'orders.' } },
          { action: { startsWith: 'payments.' } },
          { action: { startsWith: 'cash-closings.' } },
        ],
      },
    });
    await prisma.cashClosing.deleteMany();
    await prisma.paymentAttempt.deleteMany();
    await prisma.refund.deleteMany();
    await prisma.payment.deleteMany();
    await prisma.stockMovement.deleteMany();
    await prisma.orderStatusHistory.deleteMany();
    await prisma.orderLine.deleteMany();
    await prisma.order.deleteMany();
    await prisma.reservation.deleteMany();
    await prisma.idempotencyKey.deleteMany();
    await prisma.pricePeriod.deleteMany();
    await prisma.variantPrice.deleteMany();
    await prisma.stockItem.deleteMany();
    await prisma.warehouse.deleteMany({
      where: { code: { in: ['L204', 'L206'] } },
    });
    await prisma.productVariant.deleteMany();
    await prisma.product.deleteMany();
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
  const seller = staff('orders.read', 'orders.place', 'payments.manage');
  const owner = staff(
    'orders.read',
    'orders.manage',
    'payments.manage',
    'cash-closings.read',
    'cash-closings.manage',
  );
  const reader = staff('cash-closings.read');

  /** Today in central Mexico, as the API takes the day. */
  const today = () => mexicoDateOf(new Date());

  async function warehouse(code: 'L204' | 'L206'): Promise<string> {
    const id = newId();
    await prisma.warehouse.create({
      data: {
        id,
        code,
        name: `Local ${code.slice(1)}`,
        status: 'ACTIVE',
        priority: code === 'L204' ? 2 : 3,
      },
    });
    return id;
  }

  /** A published variant at $100.00, with 50 units in the warehouse. */
  async function variant(warehouseId: string): Promise<string> {
    const productId = newId();
    const id = newId();
    await prisma.product.create({
      data: {
        id: productId,
        title: 'Control inalámbrico',
        slug: `control-${productId.slice(-12)}`,
        status: 'PUBLISHED',
        variants: {
          create: {
            id,
            sku: `CTL-${id.slice(-12)}`.toUpperCase(),
            options: {},
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
      data: { id: newId(), variantId: id, warehouseId, onHand: 50 },
    });
    return id;
  }

  /** A counter sale of `units` at $100.00 each, collected with `method`, or left unpaid without one. */
  async function sale(
    warehouseId: string,
    variantId: string,
    units: number,
    method?: 'CASH' | 'CARD_TERMINAL' | 'TRANSFER',
  ): Promise<string> {
    const { body } = await http()
      .post('/v1/admin/orders')
      .set(signedInAs(seller))
      .set('Idempotency-Key', randomUUID())
      .send({
        lines: [{ variantId, quantity: units }],
        warehouseId,
        fulfillment: 'IN_STORE',
        expectedTotal: units * 10_000,
      })
      .expect(201);
    if (method !== undefined) {
      await http()
        .post(`/v1/admin/orders/${body.id}/manual-capture`)
        .set(signedInAs(seller))
        .send({ reference: 'Ticket 00500', method })
        .expect(200);
      await idle();
    }
    return body.id as string;
  }

  /** Cancels a paid sale and gives its money back. */
  async function refunded(orderId: string): Promise<void> {
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
    });
    await http()
      .post(`/v1/admin/orders/${orderId}/cancel`)
      .set(signedInAs(owner))
      .send({ reason: 'El cliente se arrepintió', version: order.version })
      .expect(200);
    await idle();
    const payment = await prisma.payment.findFirstOrThrow({
      where: { orderId },
    });
    await http()
      .post(`/v1/admin/payments/${payment.id}/refunds/manual`)
      .set(signedInAs(owner))
      .send({ reference: 'Devolución 00090', version: payment.version })
      .expect(200);
    await idle();
  }

  const summary = (warehouseId: string, date = today(), by = owner) =>
    http()
      .get(`${CLOSINGS}/summary?warehouseId=${warehouseId}&date=${date}`)
      .set(signedInAs(by));

  const close = (body: object, by = owner) =>
    http().post(CLOSINGS).set(signedInAs(by)).send(body);

  it('sums up the day of one store: sales, payments by method and person, refunds and the expected cash', async () => {
    const local204 = await warehouse('L204');
    const local206 = await warehouse('L206');
    const game = await variant(local204);
    const other = await variant(local206);
    await sale(local204, game, 2, 'CASH');
    await sale(local204, game, 1, 'CARD_TERMINAL');
    await sale(local204, game, 1);
    await refunded(await sale(local204, game, 1, 'CASH'));
    await sale(local206, other, 3, 'CASH');

    const { body } = await summary(local204).expect(200);

    expect(body).toMatchObject({
      warehouseId: local204,
      date: today(),
      placedCount: 4,
      placedAmount: mxn(50_000),
      pendingPaymentCount: 1,
      cancelledCount: 1,
      payments: [
        { method: 'CASH', count: 2, amount: mxn(30_000) },
        { method: 'CARD_TERMINAL', count: 1, amount: mxn(10_000) },
        { method: 'TRANSFER', count: 0, amount: mxn(0) },
        { method: null, count: 0, amount: mxn(0) },
      ],
      paymentAmount: mxn(40_000),
      refundCount: 1,
      refundAmount: mxn(10_000),
      cashRefundAmount: mxn(10_000),
      expectedCash: mxn(20_000),
      byStaff: [
        {
          staffId: seller.id,
          paymentCount: 3,
          paymentAmount: mxn(40_000),
          cashAmount: mxn(30_000),
          refundAmount: mxn(0),
        },
        {
          staffId: owner.id,
          paymentCount: 0,
          paymentAmount: mxn(0),
          cashAmount: mxn(0),
          refundAmount: mxn(10_000),
        },
      ],
      openPriceLineCount: 0,
      openPriceAmount: mxn(0),
      closing: null,
      afterClosing: null,
    });
    expect((await summary(local206).expect(200)).body.expectedCash).toEqual(
      mxn(30_000),
    );
  });

  it('closes the day once with the counted cash, a note for the difference, and shows what came after', async () => {
    const local204 = await warehouse('L204');
    const game = await variant(local204);
    await sale(local204, game, 3, 'CASH');

    const { body: problem } = await close({
      warehouseId: local204,
      date: today(),
      countedCash: 29_000,
    }).expect(400);
    expect(problem.errors).toEqual([
      expect.objectContaining({
        field: 'note',
        code: 'requiredWithDifference',
      }),
    ]);

    const created = await close({
      warehouseId: local204,
      date: today(),
      countedCash: 29_000,
      note: 'Faltan $10 de un cambio',
    }).expect(201);
    const closing = created.body;
    expect(created.headers.location).toBe(`${CLOSINGS}/${closing.id}`);
    expect(closing).toMatchObject({
      warehouseId: local204,
      date: today(),
      expectedCash: mxn(30_000),
      countedCash: mxn(29_000),
      difference: mxn(-1_000),
      note: 'Faltan $10 de un cambio',
      closedBy: owner.id,
      summary: { placedCount: 1, expectedCash: mxn(30_000) },
    });
    const audits = await prisma.auditLog.findMany({
      where: { action: 'cash-closings.close' },
    });
    expect(audits).toEqual([
      expect.objectContaining({
        actorId: owner.id,
        resourceType: 'cash-closing',
        resourceId: closing.id,
        changes: {
          warehouseId: { from: null, to: local204 },
          date: { from: null, to: today() },
          expectedCash: { from: null, to: 30_000 },
          countedCash: { from: null, to: 29_000 },
          difference: { from: null, to: -1_000 },
        },
      }),
    ]);

    const { body: duplicate } = await close({
      warehouseId: local204,
      date: today(),
      countedCash: 30_000,
    }).expect(409);
    expect(duplicate.type).toMatch(/duplicate-value$/);

    await sale(local204, game, 1, 'CASH');
    const { body: after } = await summary(local204).expect(200);
    expect(after).toMatchObject({
      expectedCash: mxn(40_000),
      closing: { id: closing.id, expectedCash: mxn(30_000) },
      afterClosing: {
        paymentCount: 1,
        paymentAmount: mxn(10_000),
        cashAmount: mxn(10_000),
        refundCount: 0,
      },
    });

    const { body: read } = await http()
      .get(`${CLOSINGS}/${closing.id}`)
      .set(signedInAs(reader))
      .expect(200);
    expect(read).toEqual(closing);
    const list = async (query: string) =>
      (
        await http()
          .get(`${CLOSINGS}?${query}`)
          .set(signedInAs(reader))
          .expect(200)
      ).body;
    expect(await list(`warehouseId=${local204}`)).toMatchObject({
      data: [{ id: closing.id }],
      meta: { totalItems: 1 },
    });
    expect(
      (await list(`dateFrom=${today()}&dateTo=${today()}`)).data,
    ).toHaveLength(1);
    expect((await list(`warehouseId=${newId()}`)).data).toEqual([]);
  });

  it('closes a day without movements at zero, and refuses a day to come, a bad date and a missing store', async () => {
    const local204 = await warehouse('L204');

    await close({
      warehouseId: local204,
      date: '2026-01-15',
      countedCash: 0,
    }).expect(201);
    const { body: future } = await close({
      warehouseId: local204,
      date: '2099-01-01',
      countedCash: 0,
    }).expect(400);
    expect(future.errors).toEqual([
      expect.objectContaining({ field: 'date', code: 'notFuture' }),
    ]);
    const { body: invalid } = await summary(local204, '2026-02-30').expect(400);
    expect(invalid.errors).toEqual([
      expect.objectContaining({ field: 'date', code: 'isDate' }),
    ]);
    await summary(local204, '7-11-2026').expect(400);
    await summary(newId()).expect(404);
    await close({ warehouseId: newId(), date: today(), countedCash: 0 }).expect(
      404,
    );
    await close({
      warehouseId: local204,
      date: today(),
      countedCash: -1,
    }).expect(400);
    await http()
      .get(`${CLOSINGS}/not-an-id`)
      .set(signedInAs(reader))
      .expect(404);
  });

  it('reads with cash-closings.read and closes only with cash-closings.manage', async () => {
    const local204 = await warehouse('L204');

    await summary(local204, today(), seller).expect(403);
    await summary(local204, today(), reader).expect(200);
    await close(
      { warehouseId: local204, date: today(), countedCash: 0 },
      reader,
    ).expect(403);
    expect(await prisma.cashClosing.count()).toBe(0);
  });
});
