import {
  type AuditEntry,
  AuditTrail,
  Money,
  newId,
  TransactionManager,
  VersionConflictError,
} from '../../../shared-kernel/index.js';
import {
  type NewWorkOrderDetails,
  type UserId,
  type WarehouseId,
  WorkOrder,
  type WorkOrderId,
  type WorkOrderSnapshot,
  type WorkOrderStatusChange,
} from '../domain/work-order.js';
import { WorkOrderRepository } from '../domain/work-order.repository.js';
import { ReceiveWorkOrder } from './receive-work-order.use-case.js';
import { UpdateWorkOrder } from './update-work-order.use-case.js';
import { WorkOrderLifecycle } from './work-order-lifecycle.use-case.js';
import type {
  WorkOrderAccounts,
  WorkOrderWarehouses,
} from './work-order-ports.js';

const NOW = new Date('2026-10-15T16:00:00.000Z');
const store = newId<'Warehouse'>() as WarehouseId;
const clerk = newId<'User'>() as UserId;
const customer = newId<'User'>() as UserId;
const technician = newId<'User'>() as UserId;

const DETAILS: NewWorkOrderDetails = {
  customerId: null,
  customerName: 'María López Hernández',
  customerPhone: '4431234567',
  customerEmail: 'maria@example.com',
  equipmentType: 'Laptop',
  equipmentBrand: 'Lenovo',
  equipmentModel: null,
  serialNumber: 'PF3ABC12',
  accessories: null,
  equipmentCondition: null,
  reportedFault: 'No enciende',
  estimatedCost: null,
  technicianId: null,
};

/** Work orders in memory, with the version check of the database. */
class InMemoryWorkOrders extends WorkOrderRepository {
  readonly stored = new Map<WorkOrderId, WorkOrderSnapshot>();
  readonly history: WorkOrderStatusChange[] = [];
  saves = 0;

  insert(workOrder: WorkOrder): Promise<void> {
    this.stored.set(workOrder.id, workOrder.snapshot);
    this.history.push(...workOrder.statusChanges);
    return Promise.resolve();
  }

  find(id: WorkOrderId): Promise<WorkOrder | null> {
    const snapshot = this.stored.get(id);
    return Promise.resolve(
      snapshot === undefined ? null : WorkOrder.restore(snapshot),
    );
  }

  save(workOrder: WorkOrder): Promise<void> {
    const current = this.stored.get(workOrder.id)!;
    if (current.version !== workOrder.version) {
      throw new VersionConflictError(current.version);
    }
    this.saves += 1;
    this.stored.set(workOrder.id, {
      ...workOrder.snapshot,
      version: current.version + 1,
    });
    this.history.push(...workOrder.statusChanges);
    return Promise.resolve();
  }
}

function setUp(
  options: {
    activeWarehouse?: boolean;
    activeCustomers?: UserId[];
    activeStaff?: UserId[];
  } = {},
) {
  const calls: string[] = [];
  const workOrders = new InMemoryWorkOrders();
  const warehouses: WorkOrderWarehouses = {
    isActive: (warehouseId) => {
      calls.push(`warehouse ${warehouseId === store ? 'store' : 'other'}`);
      return Promise.resolve(options.activeWarehouse ?? true);
    },
  };
  const accounts: WorkOrderAccounts = {
    isActiveCustomer: (id) => {
      calls.push('customer');
      return Promise.resolve(
        (options.activeCustomers ?? [customer]).includes(id),
      );
    },
    isActiveStaff: (id) => {
      calls.push('staff');
      return Promise.resolve(
        (options.activeStaff ?? [technician]).includes(id),
      );
    },
  };
  const inline = {
    run: <T>(work: () => Promise<T>) => {
      calls.push('transaction');
      return work();
    },
  } as unknown as TransactionManager;
  const audited: AuditEntry[] = [];
  const audit = {
    record: (entry: AuditEntry) => {
      audited.push(entry);
      return Promise.resolve();
    },
  } as unknown as AuditTrail;
  const clock = { now: () => NOW };
  return {
    calls,
    workOrders,
    audited,
    receive: new ReceiveWorkOrder(
      workOrders,
      warehouses,
      accounts,
      inline,
      audit,
      clock,
    ),
    update: new UpdateWorkOrder(workOrders, accounts, inline, audit, clock),
    lifecycle: new WorkOrderLifecycle(workOrders, inline, audit, clock),
  };
}

type Setup = ReturnType<typeof setUp>;

/** A work order received through the use case, its audit and calls forgotten. */
async function received(
  setup: Setup,
  details: Partial<NewWorkOrderDetails> = {},
): Promise<WorkOrderId> {
  const id = await setup.receive.execute({
    staffId: clerk,
    warehouseId: store,
    details: { ...DETAILS, ...details },
  });
  setup.calls.length = 0;
  setup.audited.length = 0;
  setup.workOrders.history.length = 0;
  return id;
}

describe('ReceiveWorkOrder (UC-WRK-01)', () => {
  it('receives the equipment in the store, in the name of the staff member, and audits it without personal data', async () => {
    const setup = setUp();

    const id = await setup.receive.execute({
      staffId: clerk,
      warehouseId: store,
      details: {
        ...DETAILS,
        customerId: customer,
        estimatedCost: Money.of(35_000, 'MXN'),
        technicianId: technician,
      },
    });

    expect(setup.calls).toEqual([
      'transaction',
      'warehouse store',
      'customer',
      'staff',
    ]);
    expect(setup.workOrders.stored.get(id)).toMatchObject({
      status: 'RECEIVED',
      warehouseId: store,
      receivedBy: clerk,
      receivedAt: NOW,
      customerId: customer,
      technicianId: technician,
    });
    expect(setup.workOrders.history).toEqual([
      { from: null, to: 'RECEIVED', actorId: clerk, note: null, at: NOW },
    ]);
    expect(setup.audited).toEqual([
      {
        action: 'work-orders.create',
        resource: { type: 'work-order', id },
        changes: {
          customerId: { from: null, to: customer },
          customerName: { changed: true },
          customerPhone: { changed: true },
          customerEmail: { changed: true },
          equipmentType: { from: null, to: 'Laptop' },
          equipmentBrand: { from: null, to: 'Lenovo' },
          serialNumber: { changed: true },
          reportedFault: { changed: true },
          estimatedCost: { from: null, to: 35_000 },
          technicianId: { from: null, to: technician },
          status: { from: null, to: 'RECEIVED' },
          warehouseId: { from: null, to: store },
        },
      },
    ]);
  });

  it('checks no account when it links none', async () => {
    const setup = setUp();

    await setup.receive.execute({
      staffId: clerk,
      warehouseId: store,
      details: DETAILS,
    });

    expect(setup.calls).toEqual(['transaction', 'warehouse store']);
  });

  it('answers a warehouse that does not exist or is not active as not found, saving nothing', async () => {
    const setup = setUp({ activeWarehouse: false });

    await expect(
      setup.receive.execute({
        staffId: clerk,
        warehouseId: store,
        details: DETAILS,
      }),
    ).rejects.toMatchObject({
      code: 'not-found',
      message: `Warehouse ${store} does not exist`,
    });
    expect(setup.workOrders.stored.size).toBe(0);
    expect(setup.audited).toEqual([]);
  });

  it.each([
    ['customerId', 'Customer'],
    ['technicianId', 'Staff'],
  ] as const)(
    'answers a %s that is not an active account as not found',
    async (field, resource) => {
      const setup = setUp({ activeCustomers: [], activeStaff: [] });
      const account = newId<'User'>() as UserId;

      await expect(
        setup.receive.execute({
          staffId: clerk,
          warehouseId: store,
          details: { ...DETAILS, [field]: account },
        }),
      ).rejects.toMatchObject({
        code: 'not-found',
        message: `${resource} ${account} does not exist`,
      });
      expect(setup.workOrders.stored.size).toBe(0);
    },
  );

  it('rejects invalid data before reading anything', async () => {
    const setup = setUp();

    await expect(
      setup.receive.execute({
        staffId: clerk,
        warehouseId: store,
        details: { ...DETAILS, customerPhone: '123' },
      }),
    ).rejects.toMatchObject({ code: 'validation-error' });
    expect(setup.calls).toEqual(['transaction']);
  });
});

describe('UpdateWorkOrder (UC-WRK-03)', () => {
  it('saves and audits only what changed, the personal data without values', async () => {
    const setup = setUp();
    const id = await received(setup);

    await setup.update.execute(
      id,
      {
        customerName: 'María López',
        equipmentBrand: null,
        diagnosis: 'Disco dañado',
        estimatedCost: Money.of(120_000, 'MXN'),
        technicianId: technician,
        equipmentType: 'Laptop',
      },
      1,
    );

    expect(setup.workOrders.stored.get(id)).toMatchObject({
      customerName: 'María López',
      equipmentBrand: null,
      diagnosis: 'Disco dañado',
      estimatedCost: Money.of(120_000, 'MXN'),
      technicianId: technician,
      version: 2,
    });
    expect(setup.audited).toEqual([
      {
        action: 'work-orders.update',
        resource: { type: 'work-order', id },
        changes: {
          customerName: { changed: true },
          equipmentBrand: { from: 'Lenovo', to: null },
          diagnosis: { changed: true },
          estimatedCost: { from: null, to: 120_000 },
          technicianId: { from: null, to: technician },
        },
      },
    ]);
    expect(setup.workOrders.history).toEqual([]);
  });

  it('saves and audits nothing without changes', async () => {
    const setup = setUp();
    const id = await received(setup);

    await setup.update.execute(
      id,
      { customerName: ' María López Hernández ', equipmentModel: '' },
      1,
    );

    expect(setup.workOrders.saves).toBe(0);
    expect(setup.audited).toEqual([]);
  });

  it('checks a newly linked customer and a new technician, not the ones it already had', async () => {
    const setup = setUp({
      activeCustomers: [customer],
      activeStaff: [technician],
    });
    const id = await received(setup, {
      customerId: customer,
      technicianId: technician,
    });
    const inactive = setUp({ activeCustomers: [], activeStaff: [] });
    inactive.workOrders.stored.set(id, setup.workOrders.stored.get(id)!);

    await inactive.update.execute(
      id,
      { customerId: customer, technicianId: technician, diagnosis: 'Revisado' },
      1,
    );
    await inactive.update.execute(
      id,
      { customerId: null, technicianId: null },
      2,
    );

    expect(inactive.calls).toEqual(['transaction', 'transaction']);
    expect(inactive.workOrders.stored.get(id)).toMatchObject({
      customerId: null,
      technicianId: null,
      diagnosis: 'Revisado',
      version: 3,
    });
  });

  it.each([
    ['customerId', 'Customer'],
    ['technicianId', 'Staff'],
  ] as const)(
    'answers a new %s that is not an active account as not found, saving nothing',
    async (field, resource) => {
      const setup = setUp({ activeCustomers: [], activeStaff: [] });
      const id = await received(setup);
      const account = newId<'User'>() as UserId;

      await expect(
        setup.update.execute(id, { [field]: account }, 1),
      ).rejects.toMatchObject({
        code: 'not-found',
        message: `${resource} ${account} does not exist`,
      });
      expect(setup.workOrders.saves).toBe(0);
    },
  );

  it('answers another version as a conflict with the current one', async () => {
    const setup = setUp();
    const id = await received(setup);

    await expect(
      setup.update.execute(id, { diagnosis: 'Disco dañado' }, 2),
    ).rejects.toMatchObject({
      code: 'version-conflict',
      details: { currentVersion: 1 },
    });
    expect(setup.workOrders.saves).toBe(0);
  });

  it('answers a work order that does not exist as not found', async () => {
    const setup = setUp();
    const id = newId<'WorkOrder'>() as WorkOrderId;

    await expect(
      setup.update.execute(id, { diagnosis: 'Disco dañado' }, 1),
    ).rejects.toMatchObject({
      code: 'not-found',
      message: `WorkOrder ${id} does not exist`,
    });
  });

  it('does not edit a delivered work order', async () => {
    const setup = setUp();
    const id = await received(setup);
    await setup.lifecycle.moveTo({
      id,
      status: 'DELIVERED',
      note: null,
      staffId: clerk,
      version: 1,
    });

    await expect(
      setup.update.execute(id, { diagnosis: 'Otro' }, 2),
    ).rejects.toMatchObject({
      code: 'invalid-state-transition',
      details: { currentStatus: 'DELIVERED' },
    });
  });
});

describe('WorkOrderLifecycle (UC-WRK-04)', () => {
  it('moves it, keeps who, when and the note in the history, and audits the note as the reason', async () => {
    const setup = setUp();
    const id = await received(setup);

    await setup.lifecycle.moveTo({
      id,
      status: 'DIAGNOSED',
      note: ' Disco dañado ',
      staffId: technician,
      version: 1,
    });

    expect(setup.workOrders.stored.get(id)).toMatchObject({
      status: 'DIAGNOSED',
      version: 2,
    });
    expect(setup.workOrders.history).toEqual([
      {
        from: 'RECEIVED',
        to: 'DIAGNOSED',
        actorId: technician,
        note: 'Disco dañado',
        at: NOW,
      },
    ]);
    expect(setup.audited).toEqual([
      {
        action: 'work-orders.status',
        resource: { type: 'work-order', id },
        changes: { status: { from: 'RECEIVED', to: 'DIAGNOSED' } },
        reason: 'Disco dañado',
      },
    ]);
  });

  it('audits no reason without a note', async () => {
    const setup = setUp();
    const id = await received(setup);

    await setup.lifecycle.moveTo({
      id,
      status: 'READY',
      note: null,
      staffId: clerk,
      version: 1,
    });

    expect(setup.audited).toEqual([
      {
        action: 'work-orders.status',
        resource: { type: 'work-order', id },
        changes: { status: { from: 'RECEIVED', to: 'READY' } },
      },
    ]);
  });

  it('answers another version as a conflict, and a status behind as an invalid transition', async () => {
    const setup = setUp();
    const id = await received(setup);
    const move = (status: 'DIAGNOSED' | 'RECEIVED', version: number) =>
      setup.lifecycle.moveTo({
        id,
        status,
        note: null,
        staffId: clerk,
        version,
      });

    await expect(move('DIAGNOSED', 2)).rejects.toMatchObject({
      code: 'version-conflict',
      details: { currentVersion: 1 },
    });
    await expect(move('RECEIVED', 1)).rejects.toMatchObject({
      code: 'invalid-state-transition',
      details: { currentStatus: 'RECEIVED' },
    });
    expect(setup.workOrders.saves).toBe(0);
    expect(setup.audited).toEqual([]);
  });

  it('answers a work order that does not exist as not found', async () => {
    const setup = setUp();
    const id = newId<'WorkOrder'>() as WorkOrderId;

    await expect(
      setup.lifecycle.moveTo({
        id,
        status: 'READY',
        note: null,
        staffId: clerk,
        version: 1,
      }),
    ).rejects.toMatchObject({
      code: 'not-found',
      message: `WorkOrder ${id} does not exist`,
    });
  });
});
