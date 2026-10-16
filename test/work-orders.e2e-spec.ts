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

const RECEPTION = {
  warehouseId: MAIN,
  customerName: 'María López Hernández',
  customerPhone: '4431234567',
  customerEmail: ' Maria@Example.com ',
  equipmentType: 'Laptop',
  equipmentBrand: 'Lenovo',
  serialNumber: 'PF3ABC12',
  accessories: 'Cargador',
  reportedFault: 'No enciende',
  estimatedCost: 35_000,
};

/** Work orders over HTTP (T-189 part b, UC-WRK-01 to 04, ADR-0165, ADR-0166). */
describe('Work orders (e2e, T-189 part b)', () => {
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

  const accounts: string[] = [];

  afterEach(async () => {
    await prisma.workOrderSale.deleteMany();
    await prisma.workOrderStatusHistory.deleteMany();
    await prisma.workOrder.deleteMany();
    await prisma.idempotencyKey.deleteMany();
    await prisma.auditLog.deleteMany({
      where: { action: { startsWith: 'work-orders.' } },
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

  const receive = (body: object = RECEPTION, key: string = randomUUID()) =>
    http()
      .post(WORK_ORDERS)
      .set(signedInAs(seller))
      .set('Idempotency-Key', key)
      .send(body);

  async function received(): Promise<{ id: string; version: number }> {
    return (await receive().expect(201)).body;
  }

  /** An active account, to link as the customer or the technician of a work order. */
  async function account(type: 'CUSTOMER' | 'STAFF'): Promise<string> {
    const id = newId();
    accounts.push(id);
    await prisma.user.create({
      data: {
        id,
        type,
        email: `${id}@example.com`,
        firstNames: 'Luis',
        lastNames: 'Ramírez',
        // Not a real hash: these tests never sign in.
        passwordHash: 'not-a-real-hash',
      },
    });
    return id;
  }

  const patch = (id: string, body: object) =>
    http().patch(`${WORK_ORDERS}/${id}`).set(signedInAs(seller)).send(body);

  const moveTo = (id: string, body: object) =>
    http()
      .post(`${WORK_ORDERS}/${id}/status`)
      .set(signedInAs(seller))
      .send(body);

  describe('receiving equipment (UC-WRK-01)', () => {
    it('creates it with its folio, in the name of the staff member, once per idempotency key', async () => {
      const key = randomUUID();

      const response = await receive(RECEPTION, key).expect(201);
      const repeated = await receive(RECEPTION, key).expect(201);

      expect(response.headers.location).toBe(
        `${WORK_ORDERS}/${response.body.id}`,
      );
      expect(response.body).toEqual({
        id: expect.any(String),
        folio: expect.stringMatching(/^OT-[0-9]{6,}$/),
        status: 'RECEIVED',
        customerId: null,
        customerName: 'María López Hernández',
        customerPhone: '4431234567',
        customerEmail: 'maria@example.com',
        equipmentType: 'Laptop',
        equipmentBrand: 'Lenovo',
        equipmentModel: null,
        serialNumber: 'PF3ABC12',
        accessories: 'Cargador',
        equipmentCondition: null,
        reportedFault: 'No enciende',
        diagnosis: null,
        workPerformed: null,
        estimatedCost: { amount: 35_000, currency: 'MXN' },
        warehouseId: MAIN,
        receivedBy: seller.id,
        technicianId: null,
        receivedAt: expect.any(String),
        closedAt: null,
        blockedAt: null,
        anonymizedAt: null,
        version: 1,
        statusHistory: [
          {
            fromStatus: null,
            toStatus: 'RECEIVED',
            actorId: seller.id,
            note: null,
            occurredAt: response.body.receivedAt,
          },
        ],
        sales: [],
        paidTotal: { amount: 0, currency: 'MXN' },
        unpaidTotal: { amount: 0, currency: 'MXN' },
      });
      expect(repeated.body.id).toBe(response.body.id);
      expect(await prisma.workOrder.count()).toBe(1);
    });

    it('asks for an idempotency key', async () => {
      const response = await http()
        .post(WORK_ORDERS)
        .set(signedInAs(seller))
        .send(RECEPTION)
        .expect(400);

      expect(response.body.type).toBe('/problems/idempotency-key-missing');
    });

    it.each([
      [{ customerName: '  ' }, 'customerName'],
      [{ customerName: undefined }, 'customerName'],
      [{ customerPhone: '443123456' }, 'customerPhone'],
      [{ customerPhone: undefined }, 'customerPhone'],
      [{ customerEmail: 'no-es-email' }, 'customerEmail'],
      [{ equipmentType: '' }, 'equipmentType'],
      [{ equipmentType: 'x'.repeat(61) }, 'equipmentType'],
      [{ serialNumber: 'x'.repeat(61) }, 'serialNumber'],
      [{ reportedFault: undefined }, 'reportedFault'],
      [{ estimatedCost: -1 }, 'estimatedCost'],
      [{ estimatedCost: 10.5 }, 'estimatedCost'],
      [{ warehouseId: 'principal' }, 'warehouseId'],
      [{ customerId: 'cliente' }, 'customerId'],
      [{ technicianId: 'tecnico' }, 'technicianId'],
    ])('answers 400 validation-error for %j', async (changes, field) => {
      const response = await receive({ ...RECEPTION, ...changes }).expect(400);

      expect(response.body.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ field })]),
      );
    });

    it('answers a warehouse, a customer or a technician that does not exist as not found', async () => {
      for (const changes of [
        { warehouseId: newId() },
        { customerId: newId() },
        { technicianId: newId() },
      ]) {
        await receive({ ...RECEPTION, ...changes }).expect(404);
      }
      expect(await prisma.workOrder.count()).toBe(0);
    });
  });

  describe('finding them (UC-WRK-02)', () => {
    it('lists and searches them, and reads one with its history', async () => {
      const { id } = await received();
      const { body: other } = await receive({
        ...RECEPTION,
        customerName: 'José Pérez',
        customerPhone: '5512345678',
      }).expect(201);
      const list = (query: string) =>
        http()
          .get(`${WORK_ORDERS}?${query}`)
          .set(signedInAs(staff('work-orders.read')))
          .expect(200);

      const { body: all } = await list('sort=folio');
      const { body: byFolio } = await list(`q=${other.folio.toLowerCase()}`);
      const { body: byPhone } = await list('q=551234');
      const { body: ready } = await list('status=READY,DELIVERED');

      expect(all).toMatchObject({
        data: [
          {
            id,
            status: 'RECEIVED',
            customerName: 'María López Hernández',
            equipmentType: 'Laptop',
          },
          { id: other.id },
        ],
        meta: { page: 1, totalItems: 2 },
      });
      expect(all.data[0]).not.toHaveProperty('reportedFault');
      expect(byFolio.data.map(({ id }: { id: string }) => id)).toEqual([
        other.id,
      ]);
      expect(byPhone.data.map(({ id }: { id: string }) => id)).toEqual([
        other.id,
      ]);
      expect(ready.data).toEqual([]);
      const { body: one } = await http()
        .get(`${WORK_ORDERS}/${id}`)
        .set(signedInAs(staff('work-orders.read')))
        .expect(200);
      expect(one).toMatchObject({
        id,
        statusHistory: [{ toStatus: 'RECEIVED' }],
      });
    });

    it('filters by warehouse, technician, customer and reception dates, newest first by default', async () => {
      const technician = await account('STAFF');
      const customer = await account('CUSTOMER');
      const { body: first } = await receive({
        ...RECEPTION,
        technicianId: technician,
      }).expect(201);
      const { body: second } = await receive({
        ...RECEPTION,
        customerId: customer,
      }).expect(201);
      const ids = async (query: string) =>
        (
          await http()
            .get(`${WORK_ORDERS}?${query}`)
            .set(signedInAs(staff('work-orders.read')))
            .expect(200)
        ).body.data.map(({ id }: { id: string }) => id);
      const today = new Date().toISOString().slice(0, 10);
      const tomorrow = new Date(Date.now() + 86_400_000)
        .toISOString()
        .slice(0, 10);

      expect(await ids('')).toEqual([second.id, first.id]);
      expect(await ids(`technicianId=${technician}`)).toEqual([first.id]);
      expect(await ids(`customerId=${customer}`)).toEqual([second.id]);
      expect(await ids(`warehouseId=${MAIN}`)).toHaveLength(2);
      expect(await ids(`warehouseId=${newId()}`)).toEqual([]);
      expect(
        await ids(`receivedFrom=${today}&receivedTo=${today}`),
      ).toHaveLength(2);
      expect(await ids(`receivedFrom=${tomorrow}`)).toEqual([]);
      expect(await ids(`receivedTo=${today}T00:00:00.000Z`)).toEqual([]);
    });

    it('answers a work order that does not exist as not found, and a bad filter as 400', async () => {
      const reader = signedInAs(staff('work-orders.read'));

      await http().get(`${WORK_ORDERS}/${newId()}`).set(reader).expect(404);
      await http().get(`${WORK_ORDERS}/OT-000001`).set(reader).expect(404);
      await http().get(`${WORK_ORDERS}?status=LISTA`).set(reader).expect(400);
      await http()
        .get(`${WORK_ORDERS}?sort=customerName`)
        .set(reader)
        .expect(400);
    });
  });

  describe('changing them (UC-WRK-03 and 04)', () => {
    it('corrects only what is sent and records the diagnosis, clearing an optional field with null', async () => {
      const technician = await account('STAFF');
      const customer = await account('CUSTOMER');
      const { body: created } = await receive({
        ...RECEPTION,
        customerId: customer,
        technicianId: technician,
      }).expect(201);

      const { body: diagnosed } = await patch(created.id, {
        diagnosis: 'Disco dañado',
        accessories: null,
        version: 1,
      }).expect(200);
      const { body: estimated } = await patch(created.id, {
        estimatedCost: 120_000,
        technicianId: null,
        version: 2,
      }).expect(200);

      expect(diagnosed).toMatchObject({
        diagnosis: 'Disco dañado',
        accessories: null,
        estimatedCost: { amount: 35_000, currency: 'MXN' },
        customerId: customer,
        technicianId: technician,
        customerName: 'María López Hernández',
        version: 2,
      });
      expect(estimated).toMatchObject({
        estimatedCost: { amount: 120_000, currency: 'MXN' },
        technicianId: null,
        customerId: customer,
        diagnosis: 'Disco dañado',
        version: 3,
      });
    });

    it.each([
      [{ customerName: null }, 'customerName'],
      [{ customerPhone: null }, 'customerPhone'],
      [{ equipmentType: null }, 'equipmentType'],
      [{ reportedFault: null }, 'reportedFault'],
      [{ diagnosis: 'x'.repeat(4001) }, 'diagnosis'],
      [{ version: undefined }, 'version'],
    ])(
      'answers 400 validation-error for the change %j',
      async (changes, field) => {
        const { id } = await received();

        const response = await http()
          .patch(`${WORK_ORDERS}/${id}`)
          .set(signedInAs(seller))
          .send({ version: 1, ...changes })
          .expect(400);

        expect(response.body.errors).toEqual(
          expect.arrayContaining([expect.objectContaining({ field })]),
        );
      },
    );

    it('answers an outdated version as a conflict', async () => {
      const { id } = await received();

      const response = await http()
        .patch(`${WORK_ORDERS}/${id}`)
        .set(signedInAs(seller))
        .send({ diagnosis: 'Disco dañado', version: 2 })
        .expect(409);

      expect(response.body).toMatchObject({
        type: '/problems/version-conflict',
        currentVersion: 1,
      });
    });

    it('moves it forward, skipping steps, and delivers it without asking for payment', async () => {
      const { id } = await received();

      await moveTo(id, {
        status: 'DIAGNOSED',
        note: 'Disco dañado',
        version: 1,
      }).expect(200);
      const { body } = await moveTo(id, {
        status: 'DELIVERED',
        version: 2,
      }).expect(200);

      expect(body).toMatchObject({
        status: 'DELIVERED',
        closedAt: expect.any(String),
        version: 3,
        statusHistory: [
          { toStatus: 'RECEIVED' },
          {
            fromStatus: 'RECEIVED',
            toStatus: 'DIAGNOSED',
            note: 'Disco dañado',
          },
          { fromStatus: 'DIAGNOSED', toStatus: 'DELIVERED', note: null },
        ],
      });
      const edit = await http()
        .patch(`${WORK_ORDERS}/${id}`)
        .set(signedInAs(seller))
        .send({ diagnosis: 'Otro', version: 3 })
        .expect(409);
      expect(edit.body).toMatchObject({
        type: '/problems/invalid-state-transition',
        currentStatus: 'DELIVERED',
      });
    });

    it('never goes back, and cancels only with a note', async () => {
      const { id } = await received();
      await moveTo(id, { status: 'READY', version: 1 }).expect(200);

      const back = await moveTo(id, { status: 'DIAGNOSED', version: 2 }).expect(
        409,
      );
      const noNote = await moveTo(id, {
        status: 'CANCELLED',
        version: 2,
      }).expect(400);
      const { body } = await moveTo(id, {
        status: 'CANCELLED',
        note: 'Se lo llevó sin reparar',
        version: 2,
      }).expect(200);

      expect(back.body).toMatchObject({
        type: '/problems/invalid-state-transition',
        currentStatus: 'READY',
      });
      expect(noNote.body.errors).toEqual([
        expect.objectContaining({ field: 'note' }),
      ]);
      expect(body).toMatchObject({
        status: 'CANCELLED',
        closedAt: expect.any(String),
      });
      await moveTo(id, { status: 'LISTA', version: 3 }).expect(400);
    });
  });
});
