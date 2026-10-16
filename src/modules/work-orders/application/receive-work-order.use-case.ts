import { Injectable } from '@nestjs/common';
import {
  AuditTrail,
  changesBetween,
  Clock,
  newId,
  NotFoundError,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import {
  type NewWorkOrderDetails,
  type UserId,
  type WarehouseId,
  WorkOrder,
  type WorkOrderId,
} from '../domain/work-order.js';
import { WorkOrderRepository } from '../domain/work-order.repository.js';
import { WorkOrderAccounts, WorkOrderWarehouses } from './work-order-ports.js';
import {
  assertAccounts,
  auditedWorkOrderFields,
  PERSONAL_WORK_ORDER_FIELDS,
} from './work-order-support.js';

/**
 * Receives equipment in the physical store (UC-WRK-01, ADR-0165, ADR-0166): a new work order in RECEIVED, in the
 * active warehouse of the store and in the name of the staff member who receives it, with the next folio. A linked
 * customer must be active, and a technician an active staff member. Audited as `work-orders.create`.
 */
@Injectable()
export class ReceiveWorkOrder {
  constructor(
    private readonly workOrders: WorkOrderRepository,
    private readonly warehouses: WorkOrderWarehouses,
    private readonly accounts: WorkOrderAccounts,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  /** @throws NotFoundError for a warehouse that is not active, a customer or a technician; InvalidValueError. */
  execute(input: {
    staffId: UserId;
    warehouseId: WarehouseId;
    details: NewWorkOrderDetails;
  }): Promise<WorkOrderId> {
    return this.transactions.run(async () => {
      const now = this.clock.now();
      const workOrder = WorkOrder.receive({
        id: newId(),
        details: input.details,
        warehouseId: input.warehouseId,
        receivedBy: input.staffId,
        at: now,
      });
      if (!(await this.warehouses.isActive(input.warehouseId))) {
        throw new NotFoundError('Warehouse', input.warehouseId);
      }
      await assertAccounts(this.accounts, input.details);
      await this.workOrders.insert(workOrder, now);
      const received = {
        ...auditedWorkOrderFields(workOrder),
        status: workOrder.status,
        warehouseId: input.warehouseId,
      };
      await this.audit.record({
        action: 'work-orders.create',
        resource: { type: 'work-order', id: workOrder.id },
        changes: changesBetween(
          Object.fromEntries(Object.keys(received).map((key) => [key, null])),
          received,
          { personal: PERSONAL_WORK_ORDER_FIELDS },
        ),
      });
      return workOrder.id;
    });
  }
}
