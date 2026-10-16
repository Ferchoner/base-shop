import { Injectable } from '@nestjs/common';
import {
  assertVersion,
  AuditTrail,
  changesBetween,
  Clock,
  NotFoundError,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import type { OrderId, UserId, WorkOrderId } from '../domain/work-order.js';
import { SaleNotLinkableError } from '../domain/work-order-errors.js';
import { WorkOrderRepository } from '../domain/work-order.repository.js';
import { StoreSales } from './work-order-ports.js';
import { findWorkOrder } from './work-order-support.js';

/**
 * Links the counter sales that pay for a work order, and unlinks one linked by mistake (UC-WRK-05, ADR-0167), while
 * the work order is open, with its `version`. Only a sale of the physical store that can still be paid is linked, and
 * a sale pays for one work order at most. The work order charges nothing: the sale has its own payment, and
 * delivering does not ask for it (ADR-0165). Audited as `work-orders.sale-link` and `work-orders.sale-unlink`.
 */
@Injectable()
export class WorkOrderSales {
  constructor(
    private readonly workOrders: WorkOrderRepository,
    private readonly sales: StoreSales,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  /**
   * @throws NotFoundError for the work order, or for an order that is not a sale of the store; VersionConflictError;
   *   SaleNotLinkableError when the sale expired, was cancelled or was refunded; InvalidStateTransitionError when the
   *   work order was delivered or cancelled; DuplicateValueError when the sale is already linked, to this work order
   *   or to another one.
   */
  link(input: {
    id: WorkOrderId;
    orderId: OrderId;
    staffId: UserId;
    version: number;
  }): Promise<void> {
    return this.transactions.run(async () => {
      const workOrder = await findWorkOrder(this.workOrders, input.id);
      assertVersion(workOrder.version, input.version);
      const [sale] = await this.sales.of([input.orderId]);
      if (sale === undefined) {
        throw new NotFoundError('Store sale', input.orderId);
      }
      if (sale.payment === 'NONE') throw new SaleNotLinkableError(sale.status);
      const now = this.clock.now();
      workOrder.linkSale(input.orderId, input.staffId, now);
      await this.workOrders.save(workOrder, now);
      await this.audit.record({
        action: 'work-orders.sale-link',
        resource: { type: 'work-order', id: input.id },
        changes: changesBetween({ orderId: null }, { orderId: input.orderId }),
      });
    });
  }

  /**
   * @throws NotFoundError for the work order, or a sale it does not have; VersionConflictError;
   *   InvalidStateTransitionError when it was delivered or cancelled.
   */
  unlink(input: {
    id: WorkOrderId;
    orderId: OrderId;
    version: number;
  }): Promise<void> {
    return this.transactions.run(async () => {
      const workOrder = await findWorkOrder(this.workOrders, input.id);
      assertVersion(workOrder.version, input.version);
      workOrder.unlinkSale(input.orderId);
      await this.workOrders.save(workOrder, this.clock.now());
      await this.audit.record({
        action: 'work-orders.sale-unlink',
        resource: { type: 'work-order', id: input.id },
        changes: changesBetween({ orderId: input.orderId }, { orderId: null }),
      });
    });
  }
}
