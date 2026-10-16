import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import {
  type AuditEntry,
  AuditTrail,
  newId,
  TransactionManager,
  VersionConflictError,
} from '../../../shared-kernel/index.js';
import {
  type UserId,
  type WarehouseId,
  WorkOrder,
  type WorkOrderId,
  type WorkOrderSnapshot,
  type WorkOrderStatus,
} from '../domain/work-order.js';
import { WorkOrderRepository } from '../domain/work-order.repository.js';
import { WorkOrderAnonymizations } from './work-order-anonymizations.js';
import type { ReceptionResponses } from './work-order-ports.js';
import {
  RETENTION_REASON,
  WorkOrderRetention,
  type WorkOrderRetentionPolicy,
} from './work-order-retention.js';

const NOW = new Date('2026-10-16T09:00:00.000Z');
const clerk = newId<'User'>() as UserId;
const customer = newId<'User'>() as UserId;

/** A work order received on `receivedAt`, moved to `status` and, if closed, closed on `closedAt`. */
function workOrder(
  status: WorkOrderStatus,
  changes: Partial<WorkOrderSnapshot> = {},
): WorkOrderSnapshot {
  const received = WorkOrder.receive({
    id: newId(),
    details: {
      customerId: null,
      customerName: 'María López Hernández',
      customerPhone: '4431234567',
      customerEmail: null,
      equipmentType: 'Laptop',
      equipmentBrand: 'Lenovo',
      equipmentModel: null,
      serialNumber: 'PF3ABC12',
      accessories: null,
      equipmentCondition: null,
      reportedFault: 'No enciende',
      estimatedCost: null,
      technicianId: null,
    },
    warehouseId: newId<'Warehouse'>() as WarehouseId,
    receivedBy: clerk,
    at: new Date('2018-01-01T00:00:00.000Z'),
  });
  if (status === 'CANCELLED') {
    received.moveTo(status, clerk, 'Se lo llevó', NOW);
  } else if (status !== 'RECEIVED') {
    received.moveTo(status, clerk, null, NOW);
  }
  return { ...received.snapshot, ...changes };
}

/** Work orders in memory: `calls` records what was asked, in order. */
class InMemoryWorkOrders extends WorkOrderRepository {
  readonly stored = new Map<WorkOrderId, WorkOrderSnapshot>();
  readonly calls: string[] = [];
  /** IDs that `dueFor…` answers besides the ones that are due, such as one gone meanwhile. */
  readonly extraDue: WorkOrderId[] = [];
  /** IDs whose save fails. */
  readonly failing = new Set<WorkOrderId>();

  constructor(...snapshots: WorkOrderSnapshot[]) {
    super();
    for (const snapshot of snapshots) this.stored.set(snapshot.id, snapshot);
  }

  insert(): Promise<void> {
    throw new Error('Not used here');
  }

  find(): Promise<WorkOrder | null> {
    throw new Error('Not used here');
  }

  lock(id: WorkOrderId): Promise<WorkOrder | null> {
    this.calls.push(`lock ${id}`);
    const snapshot = this.stored.get(id);
    return Promise.resolve(
      snapshot === undefined ? null : WorkOrder.restore(snapshot),
    );
  }

  lockOfCustomer(customerId: UserId): Promise<WorkOrder[]> {
    this.calls.push('lockOfCustomer');
    return Promise.resolve(
      [...this.stored.values()]
        .filter(
          (snapshot) =>
            snapshot.customerId === customerId &&
            snapshot.anonymizedAt === null,
        )
        .map((snapshot) => WorkOrder.restore(snapshot)),
    );
  }

  dueForBlocking(cutoff: Date, limit: number): Promise<WorkOrderId[]> {
    this.calls.push(`dueForBlocking ${cutoff.toISOString()} ${limit}`);
    return this.due(
      (snapshot) =>
        snapshot.closedAt !== null &&
        snapshot.closedAt <= cutoff &&
        snapshot.blockedAt === null &&
        snapshot.anonymizedAt === null,
    );
  }

  dueForAnonymization(cutoff: Date, limit: number): Promise<WorkOrderId[]> {
    this.calls.push(`dueForAnonymization ${cutoff.toISOString()} ${limit}`);
    return this.due(
      (snapshot) =>
        snapshot.closedAt !== null &&
        snapshot.closedAt <= cutoff &&
        snapshot.anonymizedAt === null,
    );
  }

  save(workOrder: WorkOrder): Promise<void> {
    if (this.failing.has(workOrder.id)) {
      return Promise.reject(new Error('The database went away'));
    }
    const current = this.stored.get(workOrder.id)!;
    if (current.version !== workOrder.version) {
      throw new VersionConflictError(current.version);
    }
    this.calls.push(`save ${workOrder.id}`);
    this.stored.set(workOrder.id, {
      ...workOrder.snapshot,
      version: current.version + 1,
    });
    return Promise.resolve();
  }

  private due(
    isDue: (snapshot: WorkOrderSnapshot) => boolean,
  ): Promise<WorkOrderId[]> {
    return Promise.resolve([
      ...[...this.stored.values()].filter(isDue).map(({ id }) => id),
      ...this.extraDue,
    ]);
  }
}

function setUp(
  workOrders: InMemoryWorkOrders,
  policy: Partial<WorkOrderRetentionPolicy> = {},
) {
  const audited: AuditEntry[] = [];
  const forgotten: (readonly string[])[] = [];
  const inline = {
    run: <T>(work: () => Promise<T>) => work(),
  } as unknown as TransactionManager;
  const audit = {
    record: (entry: AuditEntry) => {
      workOrders.calls.push(`audit ${entry.action}`);
      audited.push(entry);
      return Promise.resolve();
    },
  } as unknown as AuditTrail;
  const responses: ReceptionResponses = {
    forgetOf: (ids) => {
      workOrders.calls.push('forget');
      forgotten.push(ids);
      return Promise.resolve();
    },
  };
  const clock = { now: () => NOW };
  return {
    audited,
    forgotten,
    retention: new WorkOrderRetention(workOrders, inline, audit, clock, {
      enabled: true,
      operationalMonths: 12,
      blockedMonths: 60,
      ...policy,
    }),
    anonymizations: new WorkOrderAnonymizations(
      workOrders,
      responses,
      inline,
      audit,
      clock,
    ),
  };
}

describe('WorkOrderRetention (ADR-0167)', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does nothing while the retention is disabled', async () => {
    const workOrders = new InMemoryWorkOrders(
      workOrder('DELIVERED', { closedAt: new Date('2019-01-01') }),
    );

    expect(await setUp(workOrders, { enabled: false }).retention.run()).toEqual(
      { blocked: 0, anonymized: 0, failed: 0 },
    );
    expect(workOrders.calls).toEqual([]);
  });

  it('blocks the ones closed the operational months ago and anonymizes the ones closed both periods ago, audited as the system', async () => {
    const toBlock = workOrder('DELIVERED', {
      closedAt: new Date('2025-10-16T09:00:00.000Z'),
    });
    const toAnonymize = workOrder('CANCELLED', {
      closedAt: new Date('2020-10-16T09:00:00.000Z'),
      blockedAt: new Date('2021-10-16T09:00:00.000Z'),
    });
    const recent = workOrder('DELIVERED', {
      closedAt: new Date('2025-10-16T09:00:00.001Z'),
    });
    const open = workOrder('READY');
    const workOrders = new InMemoryWorkOrders(
      toBlock,
      toAnonymize,
      recent,
      open,
    );
    const { retention, audited } = setUp(workOrders);

    const run = await retention.run();

    expect(run).toEqual({ blocked: 1, anonymized: 1, failed: 0 });
    expect(workOrders.calls).toEqual([
      // Batches of 1,000, as the retention of orders (ADR-0144).
      'dueForBlocking 2025-10-16T09:00:00.000Z 1000',
      `lock ${toBlock.id}`,
      `save ${toBlock.id}`,
      'audit work-orders.block',
      'dueForAnonymization 2020-10-16T09:00:00.000Z 1000',
      `lock ${toAnonymize.id}`,
      `save ${toAnonymize.id}`,
      'audit work-orders.anonymize',
    ]);
    expect(workOrders.stored.get(toBlock.id)).toMatchObject({
      blockedAt: NOW,
      customerName: 'María López Hernández',
    });
    expect(workOrders.stored.get(toAnonymize.id)).toMatchObject({
      customerName: null,
      customerPhone: null,
      serialNumber: null,
      reportedFault: null,
      equipmentType: 'Laptop',
      anonymizedAt: NOW,
    });
    expect(workOrders.stored.get(recent.id)?.blockedAt).toBeNull();
    expect(audited).toEqual([
      {
        action: 'work-orders.block',
        actor: { type: 'SYSTEM' },
        resource: { type: 'work-order', id: toBlock.id },
        changes: { blockedAt: { from: null, to: NOW.toISOString() } },
      },
      {
        action: 'work-orders.anonymize',
        actor: { type: 'SYSTEM' },
        resource: { type: 'work-order', id: toAnonymize.id },
        changes: {
          customerName: { changed: true },
          customerPhone: { changed: true },
          serialNumber: { changed: true },
          reportedFault: { changed: true },
        },
        reason: RETENTION_REASON,
      },
    ]);
  });

  it('anonymizes when it would block with no blocked months', async () => {
    const due = workOrder('DELIVERED', {
      closedAt: new Date('2025-10-16T09:00:00.000Z'),
    });
    const workOrders = new InMemoryWorkOrders(due);

    const run = await setUp(workOrders, { blockedMonths: 0 }).retention.run();

    expect(run).toEqual({ blocked: 1, anonymized: 1, failed: 0 });
    expect(workOrders.stored.get(due.id)).toMatchObject({
      blockedAt: NOW,
      anonymizedAt: NOW,
    });
  });

  it('skips one gone or changed meanwhile, and goes on after one that fails, which goes to the log', async () => {
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const failing = workOrder('DELIVERED', {
      closedAt: new Date('2025-01-01'),
    });
    const fine = workOrder('DELIVERED', { closedAt: new Date('2025-02-01') });
    const gone = newId<'WorkOrder'>() as WorkOrderId;
    const workOrders = new InMemoryWorkOrders(failing, fine);
    workOrders.extraDue.push(gone);
    workOrders.failing.add(failing.id);

    const run = await setUp(workOrders).retention.run();

    expect(run).toEqual({ blocked: 1, anonymized: 0, failed: 1 });
    expect(workOrders.stored.get(fine.id)?.blockedAt).toEqual(NOW);
    expect(error).toHaveBeenCalledWith(
      `Retention could not block work order ${failing.id}`,
      expect.stringContaining('The database went away'),
    );
  });

  it('anonymizes nothing anonymized or closed later meanwhile', async () => {
    const anonymized = workOrder('DELIVERED', {
      closedAt: new Date('2019-01-01'),
      anonymizedAt: new Date('2025-01-01'),
    });
    const reopened = workOrder('READY');
    const workOrders = new InMemoryWorkOrders(anonymized, reopened);
    workOrders.extraDue.push(anonymized.id, reopened.id);

    const run = await setUp(workOrders, { blockedMonths: 0 }).retention.run();

    expect(run).toEqual({ blocked: 0, anonymized: 0, failed: 0 });
    expect(workOrders.calls.filter((call) => call.startsWith('save'))).toEqual(
      [],
    );
  });
});

describe('WorkOrderAnonymizations (ADR-0067, ADR-0167)', () => {
  it('anonymizes one closed work order with the reason of the request, then forgets the response of its reception', async () => {
    const delivered = workOrder('DELIVERED', { closedAt: NOW });
    const workOrders = new InMemoryWorkOrders(delivered);
    const { anonymizations, audited, forgotten } = setUp(workOrders);

    await anonymizations.one({ id: delivered.id, reason: 'ARCO-2026-0050' });

    expect(workOrders.calls).toEqual([
      `lock ${delivered.id}`,
      `save ${delivered.id}`,
      'audit work-orders.anonymize',
      'forget',
    ]);
    expect(workOrders.stored.get(delivered.id)).toMatchObject({
      customerName: null,
      anonymizedAt: NOW,
    });
    expect(audited).toEqual([
      expect.objectContaining({
        resource: { type: 'work-order', id: delivered.id },
        reason: 'ARCO-2026-0050',
      }),
    ]);
    expect(audited[0]).not.toHaveProperty('actor');
    expect(forgotten).toEqual([[delivered.id]]);
  });

  it('does not anonymize one open, nor one that does not exist, and forgets nothing', async () => {
    const open = workOrder('IN_REPAIR');
    const workOrders = new InMemoryWorkOrders(open);
    const { anonymizations, forgotten } = setUp(workOrders);
    const unknown = newId<'WorkOrder'>() as WorkOrderId;

    await expect(
      anonymizations.one({ id: open.id, reason: 'ARCO-2026-0050' }),
    ).rejects.toMatchObject({
      code: 'invalid-state-transition',
      details: { currentStatus: 'IN_REPAIR' },
    });
    await expect(
      anonymizations.one({ id: unknown, reason: 'ARCO-2026-0050' }),
    ).rejects.toMatchObject({
      code: 'not-found',
      message: `WorkOrder ${unknown} does not exist`,
    });
    expect(forgotten).toEqual([]);
  });

  it('anonymizes every work order of a customer, then forgets their responses', async () => {
    const delivered = workOrder('DELIVERED', {
      customerId: customer,
      closedAt: NOW,
    });
    const cancelled = workOrder('CANCELLED', {
      customerId: customer,
      closedAt: NOW,
    });
    const another = workOrder('DELIVERED', { closedAt: NOW });
    const workOrders = new InMemoryWorkOrders(delivered, cancelled, another);
    const { anonymizations, audited, forgotten } = setUp(workOrders);
    const at = new Date('2026-10-16T10:00:00.000Z');

    const count = await anonymizations.ofCustomer({
      customerId: customer,
      reason: 'ARCO-2026-0051',
      at,
    });

    expect(count).toBe(2);
    for (const { id } of [delivered, cancelled]) {
      expect(workOrders.stored.get(id)).toMatchObject({ anonymizedAt: at });
    }
    expect(workOrders.stored.get(another.id)?.anonymizedAt).toBeNull();
    expect(audited.map(({ action, reason }) => [action, reason])).toEqual([
      ['work-orders.anonymize', 'ARCO-2026-0051'],
      ['work-orders.anonymize', 'ARCO-2026-0051'],
    ]);
    expect(forgotten).toEqual([[delivered.id, cancelled.id]]);
    expect(workOrders.calls.at(-1)).toBe('forget');
  });

  it('anonymizes nothing of a customer with an open work order', async () => {
    const delivered = workOrder('DELIVERED', {
      customerId: customer,
      closedAt: NOW,
    });
    const open = workOrder('READY', { customerId: customer });
    const workOrders = new InMemoryWorkOrders(delivered, open);
    const { anonymizations, forgotten } = setUp(workOrders);

    await expect(
      anonymizations.ofCustomer({
        customerId: customer,
        reason: 'ARCO-2026-0051',
        at: NOW,
      }),
    ).rejects.toMatchObject({ code: 'active-orders-exist' });
    expect(workOrders.stored.get(delivered.id)?.anonymizedAt).toBeNull();
    expect(forgotten).toEqual([]);
  });

  it('answers none for a customer without work orders', async () => {
    const { anonymizations, forgotten } = setUp(new InMemoryWorkOrders());

    expect(
      await anonymizations.ofCustomer({
        customerId: customer,
        reason: 'ARCO-2026-0051',
        at: NOW,
      }),
    ).toBe(0);
    expect(forgotten).toEqual([[]]);
  });

  it('reads the data of a blocked work order, as saved, auditing the reason without the data', async () => {
    const blocked = workOrder('DELIVERED', {
      closedAt: NOW,
      blockedAt: NOW,
      customerEmail: 'maria@example.com',
    });
    const workOrders = new InMemoryWorkOrders(blocked);
    const { anonymizations, audited } = setUp(workOrders);

    const data = await anonymizations.readBlocked({
      id: blocked.id,
      reason: 'Reclamación 2026-07',
    });

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
    expect(audited).toEqual([
      {
        action: 'work-orders.read-blocked-data',
        resource: { type: 'work-order', id: blocked.id },
        reason: 'Reclamación 2026-07',
      },
    ]);
  });

  it('reads no data of one that is not blocked, nor of one anonymized, nor of one that does not exist', async () => {
    const visible = workOrder('DELIVERED', { closedAt: NOW });
    const anonymized = workOrder('CANCELLED', {
      closedAt: NOW,
      blockedAt: NOW,
      anonymizedAt: NOW,
    });
    const workOrders = new InMemoryWorkOrders(visible, anonymized);
    const { anonymizations, audited } = setUp(workOrders);
    const read = (id: WorkOrderId) =>
      anonymizations.readBlocked({ id, reason: 'Reclamación 2026-07' });

    await expect(read(visible.id)).rejects.toMatchObject({
      code: 'invalid-state-transition',
      details: { currentStatus: 'DELIVERED' },
    });
    await expect(read(anonymized.id)).rejects.toMatchObject({
      code: 'invalid-state-transition',
      details: { currentStatus: 'CANCELLED' },
    });
    await expect(read(newId())).rejects.toMatchObject({ code: 'not-found' });
    expect(audited).toEqual([]);
  });
});
