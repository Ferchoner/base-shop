import { Injectable } from '@nestjs/common';
import {
  assertVersion,
  AuditTrail,
  changesBetween,
  Clock,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import type { WorkOrderChanges, WorkOrderId } from '../domain/work-order.js';
import { WorkOrderRepository } from '../domain/work-order.repository.js';
import { WorkOrderAccounts } from './work-order-ports.js';
import {
  assertAccounts,
  auditedWorkOrderFields,
  findWorkOrder,
  PERSONAL_WORK_ORDER_FIELDS,
} from './work-order-support.js';

/**
 * Corrects the data of a work order and records its diagnosis and the work done (UC-WRK-03), with optimistic
 * locking, until it is delivered or cancelled (ADR-0166). A newly linked customer must be active, and a new
 * technician an active staff member; the ones it already had stay even if they no longer are. Without changes,
 * nothing is saved or audited. Audited as `work-orders.update`.
 */
@Injectable()
export class UpdateWorkOrder {
  constructor(
    private readonly workOrders: WorkOrderRepository,
    private readonly accounts: WorkOrderAccounts,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  /**
   * @throws NotFoundError for the work order, a customer or a technician; VersionConflictError;
   *   InvalidStateTransitionError when it was delivered or cancelled; InvalidValueError.
   */
  execute(
    id: WorkOrderId,
    changes: WorkOrderChanges,
    version: number,
  ): Promise<void> {
    return this.transactions.run(async () => {
      const workOrder = await findWorkOrder(this.workOrders, id);
      assertVersion(workOrder.version, version);
      const before = workOrder.snapshot;
      const audited = auditedWorkOrderFields(workOrder);
      workOrder.edit(changes);
      const after = workOrder.snapshot;
      await assertAccounts(this.accounts, {
        customerId:
          after.customerId === before.customerId ? null : after.customerId,
        technicianId:
          after.technicianId === before.technicianId
            ? null
            : after.technicianId,
      });
      const changed = changesBetween(
        audited,
        auditedWorkOrderFields(workOrder),
        {
          personal: PERSONAL_WORK_ORDER_FIELDS,
        },
      );
      if (Object.keys(changed).length === 0) return;
      await this.workOrders.save(workOrder, this.clock.now());
      await this.audit.record({
        action: 'work-orders.update',
        resource: { type: 'work-order', id },
        changes: changed,
      });
    });
  }
}
