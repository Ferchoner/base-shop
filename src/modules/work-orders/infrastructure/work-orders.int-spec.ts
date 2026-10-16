import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import { AppCacheModule } from '../../../platform/cache/app-cache.module.js';
import { ClockModule } from '../../../platform/clock/clock.module.js';
import { validateEnvironment } from '../../../platform/config/environment.js';
import { EventsModule } from '../../../platform/events/events.module.js';
import { IdempotencyModule } from '../../../platform/http/idempotency/idempotency.module.js';
import { RateLimitingModule } from '../../../platform/http/rate-limiting/rate-limiting.module.js';
import { MailModule } from '../../../platform/mail/mail.module.js';
import { PersistenceModule } from '../../../platform/persistence/persistence.module.js';
import { PrismaService } from '../../../platform/persistence/prisma.service.js';
import {
  Clock,
  Money,
  newId,
  type SortOrder,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import { AuditModule } from '../../audit/index.js';
import { ReceiveWorkOrder } from '../application/receive-work-order.use-case.js';
import { UpdateWorkOrder } from '../application/update-work-order.use-case.js';
import { WorkOrderLifecycle } from '../application/work-order-lifecycle.use-case.js';
import {
  type WorkOrderFilter,
  WorkOrderQueries,
  type WorkOrderSortField,
} from '../application/work-orders.queries.js';
import type {
  NewWorkOrderDetails,
  UserId,
  WarehouseId,
  WorkOrderId,
} from '../domain/work-order.js';
import { WorkOrderRepository } from '../domain/work-order.repository.js';
import { WorkOrdersModule } from '../work-orders.module.js';

/** The warehouse its migration creates (ADR-0127). */
const MAIN = '01a0f54d-639d-7173-a3ff-f510cd91429d' as WarehouseId;
const DAY = 86_400_000;

const DETAILS: NewWorkOrderDetails = {
  customerId: null,
  customerName: 'María López Hernández',
  customerPhone: '4431234567',
  customerEmail: null,
  equipmentType: 'Laptop',
  equipmentBrand: 'Lenovo',
  equipmentModel: 'ThinkPad T14',
  serialNumber: 'PF3ABC12',
  accessories: 'Cargador',
  equipmentCondition: null,
  reportedFault: 'No enciende',
  estimatedCost: null,
  technicianId: null,
};

/** Work orders against PostgreSQL 18 (T-189 part b, ADR-0165, ADR-0166). */
describe('Work orders (T-189 part b)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cls: ClsService;
  let queries: WorkOrderQueries;
  let now = new Date('2026-10-15T16:00:00.000Z');
  const clerk = newId<'User'>() as UserId;
  const users: string[] = [];
  const warehouses: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          validate: validateEnvironment,
        }),
        ClsModule.forRoot({ global: true }),
        PersistenceModule,
        ClockModule,
        AppCacheModule,
        RateLimitingModule,
        IdempotencyModule,
        MailModule,
        EventsModule,
        AuditModule,
        WorkOrdersModule,
      ],
    })
      .overrideProvider(Clock)
      .useValue({ now: () => now })
      .compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    cls = moduleRef.get(ClsService);
    queries = moduleRef.get(WorkOrderQueries);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  afterEach(async () => {
    now = new Date('2026-10-15T16:00:00.000Z');
    await prisma.workOrderStatusHistory.deleteMany();
    await prisma.workOrder.deleteMany();
    await prisma.auditLog.deleteMany({
      where: { action: { startsWith: 'work-orders.' } },
    });
    await prisma.user.deleteMany({ where: { id: { in: users.splice(0) } } });
    await prisma.warehouse.deleteMany({
      where: { id: { in: warehouses.splice(0) } },
    });
  });

  /** Runs a use case in its own async context, as a request does. */
  function run<T>(work: () => Promise<T>): Promise<T> {
    return cls.run(work);
  }

  const receive = (
    details: Partial<NewWorkOrderDetails> = {},
    warehouseId: WarehouseId = MAIN,
  ) =>
    run(() =>
      moduleRef.get(ReceiveWorkOrder).execute({
        staffId: clerk,
        warehouseId,
        details: { ...DETAILS, ...details },
      }),
    );

  const moveTo = (
    id: WorkOrderId,
    status: 'DIAGNOSED' | 'READY' | 'DELIVERED' | 'CANCELLED',
    version: number,
    note: string | null = null,
  ) =>
    run(() =>
      moduleRef
        .get(WorkOrderLifecycle)
        .moveTo({ id, status, note, staffId: clerk, version }),
    );

  async function account(
    type: 'CUSTOMER' | 'STAFF',
    status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE',
  ): Promise<UserId> {
    const id = newId<'User'>() as UserId;
    users.push(id);
    await prisma.user.create({
      data: {
        id,
        type,
        status,
        email: `${id}@example.com`,
        firstNames: 'Luis',
        lastNames: 'Ramírez',
        // Not a real hash: these tests never sign in.
        passwordHash: 'not-a-real-hash',
      },
    });
    return id;
  }

  async function warehouse(
    status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE',
  ): Promise<WarehouseId> {
    const id = newId<'Warehouse'>() as WarehouseId;
    warehouses.push(id);
    await prisma.warehouse.create({
      data: { id, code: `T-${id.slice(-8)}`, name: 'Sucursal', status },
    });
    return id;
  }

  const numberOf = async (id: WorkOrderId) =>
    Number(
      (await prisma.workOrder.findUniqueOrThrow({ where: { id } })).number,
    );

  describe('receiving equipment (UC-WRK-01)', () => {
    it('gives consecutive folios, the first history entry and its audit', async () => {
      const first = await receive();
      const second = await receive();

      const number = await numberOf(first);
      expect(await numberOf(second)).toBe(number + 1);
      const view = await queries.findWorkOrder(first);
      expect(view).toMatchObject({
        id: first,
        folio: `OT-${String(number).padStart(6, '0')}`,
        status: 'RECEIVED',
        ...DETAILS,
        diagnosis: null,
        workPerformed: null,
        warehouseId: MAIN,
        receivedBy: clerk,
        receivedAt: now,
        closedAt: null,
        version: 1,
        statusHistory: [
          {
            fromStatus: null,
            toStatus: 'RECEIVED',
            actorId: clerk,
            note: null,
            occurredAt: now,
          },
        ],
      });
      const audits = await prisma.auditLog.findMany({
        where: { action: 'work-orders.create', resourceId: first },
      });
      expect(audits).toEqual([
        expect.objectContaining({
          resourceType: 'work-order',
          changes: expect.objectContaining({
            customerName: { changed: true },
            customerPhone: { changed: true },
            equipmentType: { from: null, to: 'Laptop' },
            status: { from: null, to: 'RECEIVED' },
            warehouseId: { from: null, to: MAIN },
          }),
        }),
      ]);
    });

    it('links an active customer and technician, and keeps the estimate', async () => {
      const customer = await account('CUSTOMER');
      const technician = await account('STAFF');

      const id = await receive({
        customerId: customer,
        technicianId: technician,
        estimatedCost: Money.of(35_000, 'MXN'),
      });

      expect(await queries.findWorkOrder(id)).toMatchObject({
        customerId: customer,
        technicianId: technician,
        estimatedCost: Money.of(35_000, 'MXN'),
      });
    });

    it('answers a warehouse that is not active, a suspended customer and a technician who is not staff as not found', async () => {
      const inactive = await warehouse('INACTIVE');
      const suspended = await account('CUSTOMER', 'SUSPENDED');
      const customer = await account('CUSTOMER');

      await expect(receive({}, inactive)).rejects.toMatchObject({
        code: 'not-found',
        message: `Warehouse ${inactive} does not exist`,
      });
      await expect(receive({ customerId: suspended })).rejects.toMatchObject({
        code: 'not-found',
        message: `Customer ${suspended} does not exist`,
      });
      await expect(receive({ technicianId: customer })).rejects.toMatchObject({
        code: 'not-found',
        message: `Staff ${customer} does not exist`,
      });
      expect(await prisma.workOrder.count()).toBe(0);
      expect(await receive({}, await warehouse())).toEqual(expect.any(String));
    });

    it('lets the database reject a phone that is not 10 digits and a negative estimate', async () => {
      const id = await receive();

      await expect(
        prisma.$executeRaw`UPDATE work_orders SET customer_phone = '443123456X' WHERE id = ${id}::uuid`,
      ).rejects.toThrow(/work_orders_customer_phone_check/);
      await expect(
        prisma.$executeRaw`UPDATE work_orders SET estimated_cost = -1 WHERE id = ${id}::uuid`,
      ).rejects.toThrow(/work_orders_estimated_cost_check/);
    });
  });

  describe('changing it (UC-WRK-03 and 04)', () => {
    it('edits it and moves it, one version each, with the whole history', async () => {
      const id = await receive();
      const later = new Date(now.getTime() + DAY);

      await run(() =>
        moduleRef.get(UpdateWorkOrder).execute(
          id,
          {
            diagnosis: 'Disco dañado',
            workPerformed: 'Cambio de disco',
            estimatedCost: Money.of(120_000, 'MXN'),
            equipmentModel: null,
          },
          1,
        ),
      );
      await moveTo(id, 'DIAGNOSED', 2, 'Disco dañado');
      now = later;
      await moveTo(id, 'DELIVERED', 3);

      expect(await queries.findWorkOrder(id)).toMatchObject({
        diagnosis: 'Disco dañado',
        workPerformed: 'Cambio de disco',
        estimatedCost: Money.of(120_000, 'MXN'),
        equipmentModel: null,
        status: 'DELIVERED',
        closedAt: later,
        version: 4,
        statusHistory: [
          { fromStatus: null, toStatus: 'RECEIVED' },
          {
            fromStatus: 'RECEIVED',
            toStatus: 'DIAGNOSED',
            note: 'Disco dañado',
          },
          { fromStatus: 'DIAGNOSED', toStatus: 'DELIVERED', occurredAt: later },
        ],
      });
      expect(
        (
          await prisma.auditLog.findMany({
            where: { resourceId: id },
            orderBy: { occurredAt: 'asc' },
          })
        ).map(({ action, reason }) => [action, reason]),
      ).toEqual([
        ['work-orders.create', null],
        ['work-orders.update', null],
        ['work-orders.status', 'Disco dañado'],
        ['work-orders.status', null],
      ]);
    });

    it('saves a change only over the version it read', async () => {
      const id = await receive();
      const workOrders = moduleRef.get(WorkOrderRepository);
      const transactions = moduleRef.get(TransactionManager);
      const [one, other] = await run(() =>
        Promise.all([workOrders.find(id), workOrders.find(id)]),
      );

      one!.moveTo('DIAGNOSED', clerk, null, now);
      other!.moveTo('CANCELLED', clerk, 'Se lo llevó', now);
      await run(() => transactions.run(() => workOrders.save(one!, now)));

      await expect(
        run(() => transactions.run(() => workOrders.save(other!, now))),
      ).rejects.toMatchObject({
        code: 'version-conflict',
        details: { currentVersion: 2 },
      });
      expect(await queries.findWorkOrder(id)).toMatchObject({
        status: 'DIAGNOSED',
        statusHistory: [{ toStatus: 'RECEIVED' }, { toStatus: 'DIAGNOSED' }],
      });
    });
  });

  describe('finding them (UC-WRK-02)', () => {
    const listed = async (
      filter: WorkOrderFilter,
      sort: readonly SortOrder<WorkOrderSortField>[] = [
        { field: 'receivedAt', direction: 'desc' },
      ],
    ) =>
      (
        await queries.listWorkOrders(filter, sort, { page: 1, pageSize: 20 })
      ).items.map(({ id }) => id);

    it('finds the folio exactly, and part of the name, the phone or the serial number in any case', async () => {
      const laptop = await receive();
      const phone = await receive({
        customerName: 'José Pérez',
        customerPhone: '5512345678',
        serialNumber: 'SN-77X',
      });
      const folio = await numberOf(phone);

      for (const q of [
        `OT-${String(folio).padStart(6, '0')}`,
        `ot-${folio}`,
        'josé pé',
        '55 1234',
        '(551) 234-5678',
        'sn-77',
      ]) {
        expect([q, await listed({ q })]).toEqual([q, [phone]]);
      }
      expect(await listed({ q: 'lópez' })).toEqual([laptop]);
      expect(await listed({ q: 'nadie' })).toEqual([]);
    });

    it('filters by status, warehouse, technician, customer and reception dates', async () => {
      const technician = await account('STAFF');
      const customer = await account('CUSTOMER');
      const branch = await warehouse();
      const first = await receive({ technicianId: technician });
      now = new Date(now.getTime() + DAY);
      const second = await receive({ customerId: customer }, branch);
      now = new Date(now.getTime() + DAY);
      const third = await receive();
      await moveTo(third, 'READY', 1);

      expect(await listed({})).toEqual([third, second, first]);
      expect(await listed({ status: ['READY', 'DIAGNOSED'] })).toEqual([third]);
      expect(await listed({ warehouseId: branch })).toEqual([second]);
      expect(await listed({ technicianId: technician })).toEqual([first]);
      expect(await listed({ customerId: customer })).toEqual([second]);
      expect(
        await listed({
          receivedFrom: new Date('2026-10-16T00:00:00.000Z'),
          receivedTo: new Date('2026-10-16T23:59:59.999Z'),
        }),
      ).toEqual([second]);
    });

    it('sorts by folio either way, and counts every match across pages', async () => {
      const ids = [await receive(), await receive(), await receive()];

      expect(await listed({}, [{ field: 'folio', direction: 'asc' }])).toEqual(
        ids,
      );
      expect(await listed({}, [{ field: 'folio', direction: 'desc' }])).toEqual(
        [...ids].reverse(),
      );
      const page = await queries.listWorkOrders(
        {},
        [{ field: 'folio', direction: 'asc' }],
        { page: 2, pageSize: 2 },
      );
      expect(page).toMatchObject({
        items: [{ id: ids[2], status: 'RECEIVED' }],
        totalItems: 3,
      });
    });

    it('reads nothing for a work order that does not exist', async () => {
      expect(await queries.findWorkOrder(newId())).toBeNull();
    });
  });
});
