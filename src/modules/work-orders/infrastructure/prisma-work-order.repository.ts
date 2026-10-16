import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { Prisma } from '../../../platform/persistence/prisma/generated/client.js';
import { isUniqueViolation } from '../../../platform/persistence/prisma-errors.js';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import {
  DuplicateValueError,
  Money,
  newId,
  toId,
  VersionConflictError,
} from '../../../shared-kernel/index.js';
import {
  WorkOrder,
  type WorkOrderId,
  type WorkOrderSnapshot,
  type WorkOrderStatusChange,
} from '../domain/work-order.js';
import { WorkOrderRepository } from '../domain/work-order.repository.js';

type WorkOrderRow = Prisma.WorkOrderGetPayload<{ include: { sales: true } }>;

/**
 * Work orders in PostgreSQL (DATABASE.md §17). The number of the folio comes from the sequence of `number`, so it
 * is consecutive, with a gap only when a transaction that took one fails (ADR-0166). A change saves only over the
 * version it read (optimistic locking). A sale pays for one work order at most: the unique index on
 * `work_order_sales.order_id` answers a second link as a duplicate (ADR-0167). Dates come from the application, never
 * from the database clock.
 */
@Injectable()
export class PrismaWorkOrderRepository extends WorkOrderRepository {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  async insert(workOrder: WorkOrder, now: Date): Promise<void> {
    const w = workOrder.snapshot;
    await this.txHost.tx.workOrder.create({
      data: {
        id: w.id,
        status: w.status,
        ...detailsOf(w),
        warehouseId: w.warehouseId,
        receivedBy: w.receivedBy,
        receivedAt: w.receivedAt,
        closedAt: w.closedAt,
        version: w.version,
        createdAt: now,
        updatedAt: now,
        statusHistory: {
          create: workOrder.statusChanges.map(historyOf),
        },
      },
    });
  }

  async find(id: WorkOrderId): Promise<WorkOrder | null> {
    const row = await this.txHost.tx.workOrder.findUnique({
      where: { id },
      include: {
        sales: { orderBy: [{ linkedAt: 'asc' }, { orderId: 'asc' }] },
      },
    });
    return row === null ? null : WorkOrder.restore(toSnapshot(row));
  }

  async save(workOrder: WorkOrder, now: Date): Promise<void> {
    const w = workOrder.snapshot;
    const tx = this.txHost.tx;
    const { count } = await tx.workOrder.updateMany({
      where: { id: w.id, version: w.version },
      data: {
        status: w.status,
        ...detailsOf(w),
        closedAt: w.closedAt,
        version: { increment: 1 },
        updatedAt: now,
      },
    });
    if (count === 0) {
      const current = await tx.workOrder.findUniqueOrThrow({
        where: { id: w.id },
        select: { version: true },
      });
      throw new VersionConflictError(current.version);
    }
    if (workOrder.statusChanges.length > 0) {
      await tx.workOrderStatusHistory.createMany({
        data: workOrder.statusChanges.map((change) => ({
          ...historyOf(change),
          workOrderId: w.id,
        })),
      });
    }
    const { linked, unlinked } = workOrder.saleChanges;
    if (unlinked.length > 0) {
      await tx.workOrderSale.deleteMany({
        where: { workOrderId: w.id, orderId: { in: [...unlinked] } },
      });
    }
    if (linked.length > 0) {
      try {
        await tx.workOrderSale.createMany({
          data: linked.map((sale) => ({ ...sale, workOrderId: w.id })),
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw new DuplicateValueError('orderId');
        throw error;
      }
    }
  }
}

/** The columns of the data the staff writes. */
function detailsOf(w: WorkOrderSnapshot) {
  return {
    customerId: w.customerId,
    customerName: w.customerName,
    customerPhone: w.customerPhone,
    customerEmail: w.customerEmail,
    equipmentType: w.equipmentType,
    equipmentBrand: w.equipmentBrand,
    equipmentModel: w.equipmentModel,
    serialNumber: w.serialNumber,
    accessories: w.accessories,
    equipmentCondition: w.equipmentCondition,
    reportedFault: w.reportedFault,
    diagnosis: w.diagnosis,
    workPerformed: w.workPerformed,
    estimatedCost: w.estimatedCost?.amount ?? null,
    technicianId: w.technicianId,
  };
}

function historyOf(change: WorkOrderStatusChange) {
  return {
    id: newId(),
    fromStatus: change.from,
    toStatus: change.to,
    actorId: change.actorId,
    note: change.note,
    occurredAt: change.at,
  };
}

function toSnapshot(row: WorkOrderRow): WorkOrderSnapshot {
  return {
    id: toId<'WorkOrder'>(row.id),
    status: row.status,
    customerId: row.customerId === null ? null : toId<'User'>(row.customerId),
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    customerEmail: row.customerEmail,
    equipmentType: row.equipmentType,
    equipmentBrand: row.equipmentBrand,
    equipmentModel: row.equipmentModel,
    serialNumber: row.serialNumber,
    accessories: row.accessories,
    equipmentCondition: row.equipmentCondition,
    reportedFault: row.reportedFault,
    diagnosis: row.diagnosis,
    workPerformed: row.workPerformed,
    estimatedCost:
      row.estimatedCost === null ? null : Money.of(row.estimatedCost, 'MXN'),
    technicianId:
      row.technicianId === null ? null : toId<'User'>(row.technicianId),
    warehouseId: toId<'Warehouse'>(row.warehouseId),
    receivedBy: toId<'User'>(row.receivedBy),
    receivedAt: row.receivedAt,
    closedAt: row.closedAt,
    sales: row.sales.map((sale) => ({
      orderId: toId<'Order'>(sale.orderId),
      linkedBy: toId<'User'>(sale.linkedBy),
      linkedAt: sale.linkedAt,
    })),
    version: row.version,
  };
}
