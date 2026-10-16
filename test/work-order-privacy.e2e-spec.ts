import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import type { AuthenticatedUser } from '../src/platform/auth/authenticated-user.js';
import { configureHttp } from '../src/platform/http/configure-http.js';
import { PrismaService } from '../src/platform/persistence/prisma.service.js';
import { newId, type PermissionCode } from '../src/shared-kernel/index.js';
import {
  signedInAs,
  useTestAuthentication,
} from './support/test-authentication.js';

/** The warehouse its migration creates (ADR-0127). */
const MAIN = '01a0f54d-639d-7173-a3ff-f510cd91429d';
const WORK_ORDERS = '/v1/admin/work-orders';

/** The personal data of work orders over HTTP: blocked, read with a reason, and anonymized (T-189 part c2, ADR-0167). */
describe('Personal data of work orders (e2e, T-189 part c2)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const accounts: string[] = [];

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
    await prisma.workOrderSale.deleteMany();
    await prisma.workOrderStatusHistory.deleteMany();
    await prisma.workOrder.deleteMany();
    await prisma.idempotencyKey.deleteMany();
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { action: { startsWith: 'work-orders.' } },
          { action: { startsWith: 'customers.' } },
          { action: { startsWith: 'orders.' } },
        ],
      },
    });
    await prisma.user.deleteMany({ where: { id: { in: accounts.splice(0) } } });
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
  const seller = staff('work-orders.read', 'work-orders.manage');
  const administrator = staff('work-orders.read', 'work-orders.read-blocked');
  const privacyOfficer = staff('customers.read', 'customers.manage');

  /** A customer account, version 1. */
  async function customer(): Promise<string> {
    const id = newId();
    accounts.push(id);
    await prisma.user.create({
      data: {
        id,
        type: 'CUSTOMER',
        email: `${id}@example.com`,
        firstNames: 'Ana',
        lastNames: 'Pérez',
        passwordHash: 'not-a-real-hash',
      },
    });
    return id;
  }

  /** A work order received with an idempotency key, delivered unless said. */
  async function workOrder(
    options: { customerId?: string; open?: boolean } = {},
  ): Promise<string> {
    const { body } = await http()
      .post(WORK_ORDERS)
      .set(signedInAs(seller))
      .set('Idempotency-Key', randomUUID())
      .send({
        warehouseId: MAIN,
        customerId: options.customerId,
        customerName: 'María López Hernández',
        customerPhone: '4431234567',
        customerEmail: 'maria@example.com',
        equipmentType: 'Laptop',
        serialNumber: 'PF3ABC12',
        reportedFault: 'No enciende',
      })
      .expect(201);
    if (options.open !== true) {
      await http()
        .post(`${WORK_ORDERS}/${body.id}/status`)
        .set(signedInAs(seller))
        .send({ status: 'DELIVERED', version: 1 })
        .expect(200);
    }
    return body.id as string;
  }

  /** Blocks its data as the retention cycle does, a year after it closed. */
  const block = (id: string) =>
    prisma.workOrder.update({
      where: { id },
      data: { blockedAt: new Date() },
    });

  const read = async (id: string) =>
    (
      await http()
        .get(`${WORK_ORDERS}/${id}`)
        .set(signedInAs(seller))
        .expect(200)
    ).body;

  const readBlocked = (id: string, user = administrator) =>
    http()
      .post(`${WORK_ORDERS}/${id}/blocked-data`)
      .set(signedInAs(user))
      .send({ reason: 'Reclamación 2026-07' });

  const anonymize = (id: string) =>
    http()
      .post(`${WORK_ORDERS}/${id}/anonymize`)
      .set(signedInAs(privacyOfficer))
      .send({ reason: 'ARCO-2026-0050' });

  it('hides the data of a blocked work order, which the search no longer finds, and reads it with a reason', async () => {
    const id = await workOrder();
    const visible = await workOrder();
    await block(id);

    const view = await read(id);
    const { body: byName } = await http()
      .get(`${WORK_ORDERS}?q=María`)
      .set(signedInAs(seller))
      .expect(200);
    const { body: byFolio } = await http()
      .get(`${WORK_ORDERS}?q=${view.folio as string}`)
      .set(signedInAs(seller))
      .expect(200);
    const { body: data } = await readBlocked(id).expect(200);

    expect(view).toMatchObject({
      customerName: null,
      customerPhone: null,
      customerEmail: null,
      serialNumber: null,
      reportedFault: null,
      equipmentType: 'Laptop',
      blockedAt: expect.any(String),
      anonymizedAt: null,
    });
    expect(byName.data).toEqual([
      expect.objectContaining({
        id: visible,
        customerName: 'María López Hernández',
        customerPhone: '4431234567',
        serialNumber: 'PF3ABC12',
      }),
    ]);
    expect(byFolio.data).toEqual([
      expect.objectContaining({ id, customerName: null }),
    ]);
    expect(data).toEqual({
      customerName: 'María López Hernández',
      customerPhone: '4431234567',
      customerEmail: 'maria@example.com',
      serialNumber: 'PF3ABC12',
      accessories: null,
      equipmentCondition: null,
      reportedFault: 'No enciende',
      diagnosis: null,
      workPerformed: null,
    });
    expect(
      await prisma.auditLog.findFirstOrThrow({
        where: { action: 'work-orders.read-blocked-data', resourceId: id },
      }),
    ).toMatchObject({ reason: 'Reclamación 2026-07', changes: null });
  });

  it('reads no blocked data of one that shows its data, nor without a reason', async () => {
    const id = await workOrder();

    const visible = await readBlocked(id).expect(409);
    await http()
      .post(`${WORK_ORDERS}/${id}/blocked-data`)
      .set(signedInAs(administrator))
      .send({ reason: ' ' })
      .expect(400);

    expect(visible.body).toMatchObject({
      type: '/problems/invalid-state-transition',
      currentStatus: 'DELIVERED',
    });
  });

  it('anonymizes a closed work order of a customer without an account, forgetting the response of its reception, and only once', async () => {
    const id = await workOrder();
    const open = await workOrder({ open: true });

    const { body } = await anonymize(id).expect(200);
    const again = await anonymize(id).expect(409);
    const opened = await anonymize(open).expect(409);
    await readBlocked(id).expect(409);

    expect(body).toMatchObject({
      id,
      customerName: null,
      customerPhone: null,
      customerEmail: null,
      serialNumber: null,
      reportedFault: null,
      equipmentType: 'Laptop',
      status: 'DELIVERED',
      anonymizedAt: expect.any(String),
    });
    expect(again.body).toMatchObject({
      type: '/problems/invalid-state-transition',
    });
    expect(opened.body).toMatchObject({ currentStatus: 'RECEIVED' });
    const responses = await prisma.idempotencyKey.findMany({
      where: { endpoint: 'POST /v1/admin/work-orders' },
    });
    expect(
      responses.map(
        ({ responseBody }) =>
          (responseBody as { body: { id: string } }).body.id,
      ),
    ).toEqual([open]);
    expect(
      await prisma.auditLog.findFirstOrThrow({
        where: { action: 'work-orders.anonymize', resourceId: id },
      }),
    ).toMatchObject({
      reason: 'ARCO-2026-0050',
      actorId: privacyOfficer.id,
      changes: expect.objectContaining({ customerName: { changed: true } }),
    });
  });

  it('anonymizes the work orders of a customer with their account, once none is open', async () => {
    const userId = await customer();
    const delivered = await workOrder({ customerId: userId });
    const open = await workOrder({ customerId: userId, open: true });
    const anonymizeAccount = () =>
      http()
        .post(`/v1/admin/identity/customers/${userId}/anonymize`)
        .set(signedInAs(privacyOfficer))
        .send({ reason: 'ARCO-2026-0051', version: 1 });

    const waiting = await anonymizeAccount().expect(409);
    expect((await read(delivered)).anonymizedAt).toBeNull();
    await http()
      .post(`${WORK_ORDERS}/${open}/status`)
      .set(signedInAs(seller))
      .send({ status: 'CANCELLED', note: 'Se lo llevó', version: 1 })
      .expect(200);
    const { body } = await anonymizeAccount().expect(200);

    expect(waiting.body).toMatchObject({
      type: '/problems/active-orders-exist',
    });
    expect(body).toMatchObject({
      userId,
      anonymizedOrderCount: 0,
      anonymizedWorkOrderCount: 2,
    });
    for (const id of [delivered, open]) {
      expect(await read(id)).toMatchObject({
        customerId: userId,
        customerName: null,
        anonymizedAt: expect.any(String),
      });
    }
    expect(
      await prisma.idempotencyKey.count({
        where: { endpoint: 'POST /v1/admin/work-orders' },
      }),
    ).toBe(0);
  });
});
