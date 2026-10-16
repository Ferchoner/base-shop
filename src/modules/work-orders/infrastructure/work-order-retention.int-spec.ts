import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import pg from 'pg';
import { waitForLockWaiters } from '../../../../test/support/lock-waiters.js';
import { AppCacheModule } from '../../../platform/cache/app-cache.module.js';
import { ClockModule } from '../../../platform/clock/clock.module.js';
import { validateEnvironment } from '../../../platform/config/environment.js';
import { EventsModule } from '../../../platform/events/events.module.js';
import { IdempotencyModule } from '../../../platform/http/idempotency/idempotency.module.js';
import { RateLimitingModule } from '../../../platform/http/rate-limiting/rate-limiting.module.js';
import { MailModule } from '../../../platform/mail/mail.module.js';
import { PersistenceModule } from '../../../platform/persistence/persistence.module.js';
import { PrismaService } from '../../../platform/persistence/prisma.service.js';
import { Clock, newId } from '../../../shared-kernel/index.js';
import { AuditModule } from '../../audit/index.js';
import { ReceiveWorkOrder } from '../application/receive-work-order.use-case.js';
import { WorkOrderLifecycle } from '../application/work-order-lifecycle.use-case.js';
import {
  RETENTION_REASON,
  WorkOrderRetention,
} from '../application/work-order-retention.js';
import { WorkOrderQueries } from '../application/work-orders.queries.js';
import type { UserId, WarehouseId, WorkOrderId } from '../domain/work-order.js';
import { WorkOrderRepository } from '../domain/work-order.repository.js';
import { WorkOrdersModule } from '../work-orders.module.js';

/** The warehouse its migration creates (ADR-0127). */
const MAIN = '01a0f54d-639d-7173-a3ff-f510cd91429d' as WarehouseId;
const NOW = new Date('2026-10-16T09:00:00.000Z');

/** The retention of the data of the customers of work orders against PostgreSQL 18 (T-189 part c2, ADR-0167). */
describe('Retention of work orders (T-189 part c2)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cls: ClsService;
  let queries: WorkOrderQueries;
  const clerk = newId<'User'>() as UserId;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        // The defaults of the cycle: blocked 12 months after it closed, anonymized 60 months later (ADR-0149).
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
      .useValue({ now: () => NOW })
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
    await prisma.workOrderStatusHistory.deleteMany();
    await prisma.workOrder.deleteMany();
    await prisma.auditLog.deleteMany({
      where: { action: { startsWith: 'work-orders.' } },
    });
  });

  function run<T>(work: () => Promise<T>): Promise<T> {
    return cls.run(work);
  }

  /** A work order delivered on `closedAt`, received then too. */
  async function delivered(
    closedAt: Date,
    customerName = 'María López Hernández',
  ): Promise<WorkOrderId> {
    const id = await run(() =>
      moduleRef.get(ReceiveWorkOrder).execute({
        staffId: clerk,
        warehouseId: MAIN,
        details: {
          customerId: null,
          customerName,
          customerPhone: '4431234567',
          customerEmail: null,
          equipmentType: 'Laptop',
          equipmentBrand: null,
          equipmentModel: null,
          serialNumber: 'PF3ABC12',
          accessories: null,
          equipmentCondition: null,
          reportedFault: 'No enciende',
          estimatedCost: null,
          technicianId: null,
        },
      }),
    );
    await run(() =>
      moduleRef.get(WorkOrderLifecycle).moveTo({
        id,
        status: 'DELIVERED',
        note: null,
        staffId: clerk,
        version: 1,
      }),
    );
    await prisma.workOrder.update({ where: { id }, data: { closedAt } });
    return id;
  }

  const retention = () => run(() => moduleRef.get(WorkOrderRetention).run());

  const ids = async (q: string) =>
    (
      await queries.listWorkOrders(
        { q },
        [{ field: 'folio', direction: 'asc' }],
        { page: 1, pageSize: 20 },
      )
    ).items.map(({ id }) => id);

  it('blocks and anonymizes in the database, audited as the system, and hides the blocked data from the reads and the search', async () => {
    const toBlock = await delivered(new Date('2025-09-01T00:00:00.000Z'));
    const toAnonymize = await delivered(new Date('2019-01-01T00:00:00.000Z'));
    const recent = await delivered(new Date('2026-09-01T00:00:00.000Z'));

    const outcome = await retention();

    // The old one is due for both, so it is blocked first and anonymized in the same run.
    expect(outcome).toEqual({ blocked: 2, anonymized: 1, failed: 0 });
    expect(await queries.findWorkOrder(toBlock)).toMatchObject({
      customerName: null,
      customerPhone: null,
      serialNumber: null,
      reportedFault: null,
      equipmentType: 'Laptop',
      blockedAt: NOW,
      anonymizedAt: null,
    });
    expect(
      await prisma.workOrder.findUniqueOrThrow({ where: { id: toBlock } }),
    ).toMatchObject({ customerName: 'María López Hernández' });
    expect(
      await prisma.workOrder.findUniqueOrThrow({ where: { id: toAnonymize } }),
    ).toMatchObject({
      customerName: null,
      customerPhone: null,
      reportedFault: null,
      serialNumber: null,
      anonymizedAt: NOW,
    });
    expect((await queries.findWorkOrder(recent))?.blockedAt).toBeNull();
    expect(await ids('maría')).toEqual([recent]);
    expect(await ids('4431234567')).toEqual([recent]);
    expect(await ids('pf3abc')).toEqual([recent]);
    const folio = (await queries.findWorkOrder(toBlock))!.folio;
    expect(await ids(folio)).toEqual([toBlock]);
    const audits = await prisma.auditLog.findMany({
      where: { action: { in: ['work-orders.block', 'work-orders.anonymize'] } },
      // Same time for all of them: the IDs keep the order they were written in (UUIDv7).
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    });
    expect(
      audits.map(({ action, actorType, resourceId, reason }) => [
        action,
        actorType,
        resourceId,
        reason,
      ]),
    ).toEqual([
      // The oldest closed first.
      ['work-orders.block', 'SYSTEM', toAnonymize, null],
      ['work-orders.block', 'SYSTEM', toBlock, null],
      ['work-orders.anonymize', 'SYSTEM', toAnonymize, RETENTION_REASON],
    ]);
  });

  it('waits for a change that holds the row, and skips the work order that change anonymized', async () => {
    const id = await delivered(new Date('2019-01-01T00:00:00.000Z'));
    await prisma.workOrder.update({
      where: { id },
      data: { blockedAt: new Date('2020-01-01T00:00:00.000Z') },
    });
    const holder = new pg.Client({
      connectionString: process.env.DATABASE_URL,
    });
    await holder.connect();
    await holder.query('BEGIN');
    await holder.query(
      `UPDATE work_orders
          SET anonymized_at = now(), customer_name = NULL, customer_phone = NULL, reported_fault = NULL,
              version = version + 1
        WHERE id = $1`,
      [id],
    );

    const outcome = retention();
    await waitForLockWaiters(1);
    await holder.query('COMMIT');
    await holder.end();

    expect(await outcome).toEqual({ blocked: 0, anonymized: 0, failed: 0 });
    expect(
      await prisma.auditLog.count({
        where: { action: 'work-orders.anonymize', resourceId: id },
      }),
    ).toBe(0);
  });

  it('lists the ones due in the order they closed, up to the limit, and locks the ones of a customer that were not anonymized', async () => {
    const workOrders = moduleRef.get(WorkOrderRepository);
    const later = await delivered(new Date('2019-06-01T00:00:00.000Z'));
    const earlier = await delivered(new Date('2019-01-01T00:00:00.000Z'));
    const blocked = await delivered(new Date('2018-01-01T00:00:00.000Z'));
    await prisma.workOrder.update({
      where: { id: blocked },
      data: { blockedAt: new Date('2019-01-01T00:00:00.000Z') },
    });
    const customerId = newId<'User'>() as UserId;
    await prisma.workOrder.updateMany({
      where: { id: { in: [later, blocked] } },
      data: { customerId },
    });
    const cutoff = new Date('2019-12-31T00:00:00.000Z');

    expect(await run(() => workOrders.dueForBlocking(cutoff, 10))).toEqual([
      earlier,
      later,
    ]);
    expect(await run(() => workOrders.dueForBlocking(cutoff, 1))).toEqual([
      earlier,
    ]);
    expect(await run(() => workOrders.dueForAnonymization(cutoff, 10))).toEqual(
      [blocked, earlier, later],
    );
    expect(
      await run(() =>
        workOrders.dueForAnonymization(new Date('2018-06-01'), 10),
      ),
    ).toEqual([blocked]);
    const locked = await run(() => workOrders.lockOfCustomer(customerId));
    expect(locked.map(({ id }) => id)).toEqual([later, blocked].sort());
    await prisma.workOrder.update({
      where: { id: later },
      data: {
        anonymizedAt: NOW,
        customerName: null,
        customerPhone: null,
        reportedFault: null,
      },
    });
    expect(
      (await run(() => workOrders.lockOfCustomer(customerId))).map(
        ({ id }) => id,
      ),
    ).toEqual([blocked]);
    // Anonymized, it is due for nothing anymore.
    expect(await run(() => workOrders.dueForBlocking(cutoff, 10))).toEqual([
      earlier,
    ]);
    expect(await run(() => workOrders.dueForAnonymization(cutoff, 10))).toEqual(
      [blocked, earlier],
    );
    expect(await run(() => workOrders.lock(newId()))).toBeNull();
  });

  it('lets the database keep the data of the customer until it is anonymized, and block or anonymize only a closed work order', async () => {
    const id = await delivered(NOW);
    const open = await run(() =>
      moduleRef.get(ReceiveWorkOrder).execute({
        staffId: clerk,
        warehouseId: MAIN,
        details: {
          customerId: null,
          customerName: 'José Pérez',
          customerPhone: '5512345678',
          customerEmail: null,
          equipmentType: 'Tableta',
          equipmentBrand: null,
          equipmentModel: null,
          serialNumber: null,
          accessories: null,
          equipmentCondition: null,
          reportedFault: 'Pantalla rota',
          estimatedCost: null,
          technicianId: null,
        },
      }),
    );

    for (const column of [
      'customer_name',
      'customer_phone',
      'reported_fault',
    ]) {
      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE work_orders SET ${column} = NULL WHERE id = $1::uuid`,
          id,
        ),
      ).rejects.toThrow(/work_orders_customer_check/);
    }
    await expect(
      prisma.$executeRaw`UPDATE work_orders SET blocked_at = now() WHERE id = ${open}::uuid`,
    ).rejects.toThrow(/work_orders_blocked_at_check/);
    await expect(
      prisma.$executeRaw`UPDATE work_orders SET anonymized_at = now() WHERE id = ${open}::uuid`,
    ).rejects.toThrow(/work_orders_anonymized_at_check/);
    await prisma.$executeRaw`
      UPDATE work_orders SET anonymized_at = now(), customer_name = NULL, customer_phone = NULL, reported_fault = NULL
       WHERE id = ${id}::uuid`;
  });
});
