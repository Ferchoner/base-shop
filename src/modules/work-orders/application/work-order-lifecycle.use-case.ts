import { Injectable } from '@nestjs/common';
import {
  assertVersion,
  AuditTrail,
  changesBetween,
  Clock,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import type {
  UserId,
  WorkOrderId,
  WorkOrderStatus,
} from '../domain/work-order.js';
import { WorkOrderRepository } from '../domain/work-order.repository.js';
import { findWorkOrder } from './work-order-support.js';

/**
 * Moves a work order to another status (UC-WRK-04, ADR-0166): forward, skipping steps if needed, or to CANCELLED
 * with a note, until it is delivered or cancelled. Delivering it does not ask for payment (ADR-0165). The history
 * keeps who, when and the note. Audited as `work-orders.status`, with the note as the reason.
 */
@Injectable()
export class WorkOrderLifecycle {
  constructor(
    private readonly workOrders: WorkOrderRepository,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  /**
   * @throws NotFoundError; VersionConflictError; InvalidStateTransitionError when the status is not ahead of the
   *   current one or the work order was delivered or cancelled; InvalidValueError when a cancellation has no note.
   */
  moveTo(input: {
    id: WorkOrderId;
    status: WorkOrderStatus;
    note: string | null;
    staffId: UserId;
    version: number;
  }): Promise<void> {
    return this.transactions.run(async () => {
      const workOrder = await findWorkOrder(this.workOrders, input.id);
      assertVersion(workOrder.version, input.version);
      const from = workOrder.status;
      const now = this.clock.now();
      workOrder.moveTo(input.status, input.staffId, input.note, now);
      await this.workOrders.save(workOrder, now);
      const { note } = workOrder.statusChanges[0];
      await this.audit.record({
        action: 'work-orders.status',
        resource: { type: 'work-order', id: input.id },
        changes: changesBetween({ status: from }, { status: workOrder.status }),
        ...(note === null ? {} : { reason: note }),
      });
    });
  }
}
