import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { AuthenticatedUser } from '../src/platform/auth/authenticated-user.js';
import type { DomainEventDispatcher } from '../src/platform/events/domain-event-dispatcher.js';
import type { PrismaService } from '../src/platform/persistence/prisma.service.js';
import { newId, type PermissionCode } from '../src/shared-kernel/index.js';
import {
  signedInAs,
  useTestAuthentication,
} from './support/test-authentication.js';

/** The list and the warehouse their migrations create (ADR-0125, ADR-0127). */
const DEFAULT_LIST = '01a0f4f2-bb5f-770a-a269-105d21861fe0';
const MAIN = '01a0f54d-639d-7173-a3ff-f510cd91429d';
const WORK_ORDERS = '/v1/admin/work-orders';

const ENVIRONMENT = {
  STORE_NAME: 'Tienda Ejemplo',
  STORE_ADDRESS: 'Av. Madero Poniente 123, Centro, 58000 Morelia, Mich.',
  STORE_TAX_ID: 'eje260101ab1',
  STORE_PHONE: '443 123 4567',
  WORK_ORDER_FOOTER: ' Garantía de 30 días en la mano de obra. ',
};

const mxn = (amount: number) => ({ amount, currency: 'MXN' });

/** The counter sales that pay for a work order, and its service note, over HTTP (T-189 part c, UC-WRK-05 and 06). */
describe('Work order sales and service note (e2e, T-189 part c)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const previous: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const [name, value] of Object.entries(ENVIRONMENT)) {
      previous[name] = process.env[name];
      process.env[name] = value;
    }
    // AppModule validates the environment when it loads, so import it after setting the variables.
    const { AppModule } = await import('../src/app.module.js');
    const { configureHttp } =
      await import('../src/platform/http/configure-http.js');
    const { PrismaService: Prisma } =
      await import('../src/platform/persistence/prisma.service.js');
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication<INestApplication<App>>();
    useTestAuthentication(app);
    configureHttp(app);
    await app.init();
    prisma = app.get(Prisma);
  });

  afterEach(async () => {
    const { DomainEventDispatcher: Dispatcher } =
      await import('../src/platform/events/domain-event-dispatcher.js');
    await app.get<DomainEventDispatcher>(Dispatcher).whenIdle();
    await prisma.workOrderSale.deleteMany();
    await prisma.workOrderStatusHistory.deleteMany();
    await prisma.workOrder.deleteMany();
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { action: { startsWith: 'work-orders.' } },
          { action: { startsWith: 'orders.' } },
          { action: { startsWith: 'payments.' } },
        ],
      },
    });
    await prisma.paymentAttempt.deleteMany();
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
    await prisma.productVariant.deleteMany();
    await prisma.product.deleteMany();
  });

  afterAll(async () => {
    await app.close();
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  const http = () => request(app.getHttpServer());

  const staff = (...permissions: PermissionCode[]): AuthenticatedUser => ({
    id: newId(),
    type: 'STAFF',
    permissions,
    mustChangePassword: false,
    sessionId: newId(),
  });
  /** As the seeded Vendedor role, which attends the counter (ADR-0161, ADR-0165). */
  const seller = staff(
    'catalog.read',
    'inventory.read',
    'orders.read',
    'orders.place',
    'customers.read',
    'work-orders.read',
    'work-orders.manage',
  );
  const cashier = staff('orders.read', 'payments.manage');
  const manager = staff('orders.read', 'orders.manage');

  /** A published service at $350.00 a unit, with plenty of units in the main warehouse. */
  async function service(): Promise<string> {
    const productId = newId();
    const variantId = newId();
    await prisma.product.create({
      data: {
        id: productId,
        title: 'Revisión de equipo',
        slug: `revision-${productId.slice(-12)}`,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        firstPublishedAt: new Date(),
        storeOnly: true,
        variants: {
          create: {
            id: variantId,
            sku: `SERV-${variantId.slice(-12)}`.toUpperCase(),
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
        variantId,
        periods: {
          create: {
            id: newId(),
            amount: 35_000,
            effectiveFrom: new Date(Date.now() - 86_400_000),
            createdBy: newId(),
          },
        },
      },
    });
    await prisma.stockItem.create({
      data: { id: newId(), variantId, warehouseId: MAIN, onHand: 100_000 },
    });
    return variantId;
  }

  /** A sale at the counter of `units` of the service, waiting for its payment. */
  async function counterSale(variantId: string, units = 1): Promise<string> {
    const { body } = await http()
      .post('/v1/admin/orders')
      .set(signedInAs(seller))
      .set('Idempotency-Key', randomUUID())
      .send({
        lines: [{ variantId, quantity: units }],
        warehouseId: MAIN,
        fulfillment: 'IN_STORE',
        expectedTotal: units * 35_000,
      })
      .expect(201);
    return body.id as string;
  }

  async function workOrder(): Promise<string> {
    const { body } = await http()
      .post(WORK_ORDERS)
      .set(signedInAs(seller))
      .set('Idempotency-Key', randomUUID())
      .send({
        warehouseId: MAIN,
        customerName: 'María López Hernández',
        customerPhone: '4431234567',
        equipmentType: 'Laptop',
        reportedFault: 'No enciende',
      })
      .expect(201);
    return body.id as string;
  }

  const link = (id: string, orderId: string, version: number) =>
    http()
      .post(`${WORK_ORDERS}/${id}/sales`)
      .set(signedInAs(seller))
      .send({ orderId, version });

  const unlink = (id: string, orderId: string, version?: number) =>
    http()
      .delete(
        `${WORK_ORDERS}/${id}/sales/${orderId}${version === undefined ? '' : `?version=${version}`}`,
      )
      .set(signedInAs(seller));

  const read = async (id: string) =>
    (
      await http()
        .get(`${WORK_ORDERS}/${id}`)
        .set(signedInAs(seller))
        .expect(200)
    ).body;

  it('links counter sales and shows whether each is paid, with what was paid and what is still owed', async () => {
    const variantId = await service();
    const deposit = await counterSale(variantId);
    const settlement = await counterSale(variantId, 2);
    const id = await workOrder();

    const { body: linked } = await link(id, deposit, 1).expect(200);
    await http()
      .post(`/v1/admin/orders/${deposit}/manual-capture`)
      .set(signedInAs(cashier))
      .send({ reference: 'Ticket 00452', method: 'CASH' })
      .expect(200);
    await link(id, settlement, 2).expect(200);
    const both = await read(id);

    const { publicCode, orderNumber } = await prisma.order.findUniqueOrThrow({
      where: { id: deposit },
    });
    expect(linked).toMatchObject({
      version: 2,
      sales: [
        {
          orderId: deposit,
          publicCode: `${publicCode.slice(0, 4)}-${publicCode.slice(4)}`,
          orderNumber: Number(orderNumber),
          status: 'PENDING_PAYMENT',
          paid: false,
          grandTotal: mxn(35_000),
          placedAt: expect.any(String),
          paidAt: null,
          linkedBy: seller.id,
          linkedAt: expect.any(String),
        },
      ],
      paidTotal: mxn(0),
      unpaidTotal: mxn(35_000),
    });
    expect(both).toMatchObject({
      version: 3,
      sales: [
        {
          orderId: deposit,
          status: 'PAID',
          paid: true,
          paidAt: expect.any(String),
        },
        { orderId: settlement, paid: false, grandTotal: mxn(70_000) },
      ],
      paidTotal: mxn(35_000),
      unpaidTotal: mxn(70_000),
    });
    expect(
      await prisma.auditLog.count({
        where: { action: 'work-orders.sale-link', resourceId: id },
      }),
    ).toBe(2);
  });

  it('links a sale to one work order only, never one that cannot be paid nor one that does not exist, and unlinks one linked by mistake', async () => {
    const variantId = await service();
    const sale = await counterSale(variantId);
    const cancelled = await counterSale(variantId);
    await http()
      .post(`/v1/admin/orders/${cancelled}/cancel`)
      .set(signedInAs(manager))
      .send({ reason: 'El cliente ya no lo quiso', version: 1 })
      .expect(200);
    const mistaken = await workOrder();
    const right = await workOrder();
    await link(mistaken, sale, 1).expect(200);

    const duplicate = await link(right, sale, 1).expect(409);
    const ended = await link(right, cancelled, 1).expect(409);
    await link(right, newId(), 1).expect(404);
    await link(right, 'K7M4-Q9XA', 1).expect(400);
    const stale = await unlink(mistaken, sale, 1).expect(409);
    await unlink(mistaken, sale).expect(400);
    await unlink(mistaken, newId(), 2).expect(404);
    const { body: unlinked } = await unlink(mistaken, sale, 2).expect(200);
    const { body: relinked } = await link(right, sale, 1).expect(200);

    expect(duplicate.body).toMatchObject({
      type: '/problems/duplicate-value',
      field: 'orderId',
    });
    expect(ended.body).toMatchObject({
      type: '/problems/sale-not-linkable',
      saleStatus: 'CANCELLED',
    });
    expect(stale.body).toMatchObject({
      type: '/problems/version-conflict',
      currentVersion: 2,
    });
    expect(unlinked).toMatchObject({ sales: [], version: 3 });
    expect(relinked.sales).toEqual([
      expect.objectContaining({ orderId: sale }),
    ]);
    expect(
      await prisma.auditLog.findFirstOrThrow({
        where: { action: 'work-orders.sale-unlink', resourceId: mistaken },
      }),
    ).toMatchObject({ changes: { orderId: { from: sale, to: null } } });
  });

  it('delivers a work order whose sale waits for its payment, and then neither links nor unlinks sales', async () => {
    const variantId = await service();
    const sale = await counterSale(variantId);
    const other = await counterSale(variantId);
    const id = await workOrder();
    await link(id, sale, 1).expect(200);

    await http()
      .post(`${WORK_ORDERS}/${id}/status`)
      .set(signedInAs(seller))
      .send({ status: 'DELIVERED', version: 2 })
      .expect(200);
    const linking = await link(id, other, 3).expect(409);
    const unlinking = await unlink(id, sale, 3).expect(409);

    for (const { body } of [linking, unlinking]) {
      expect(body).toMatchObject({
        type: '/problems/invalid-state-transition',
        currentStatus: 'DELIVERED',
      });
    }
    expect(await read(id)).toMatchObject({
      status: 'DELIVERED',
      sales: [{ orderId: sale, paid: false }],
      unpaidTotal: mxn(35_000),
    });
  });

  it('gives the data to print the service note: the work order with its sales, the store and its terms', async () => {
    const variantId = await service();
    const sale = await counterSale(variantId);
    const id = await workOrder();
    await link(id, sale, 1).expect(200);

    const { body } = await http()
      .get(`${WORK_ORDERS}/${id}/service-note`)
      .set(signedInAs(staff('work-orders.read')))
      .expect(200);

    expect(body).toEqual({
      workOrder: await read(id),
      store: {
        name: 'Tienda Ejemplo',
        address: 'Av. Madero Poniente 123, Centro, 58000 Morelia, Mich.',
        taxId: 'EJE260101AB1',
        phone: '443 123 4567',
      },
      terms: 'Garantía de 30 días en la mano de obra.',
    });
    await http()
      .get(`${WORK_ORDERS}/${newId()}/service-note`)
      .set(signedInAs(staff('work-orders.read')))
      .expect(404);
  });
});
