import { Inject, Injectable } from '@nestjs/common';
import { Money } from '../../../shared-kernel/index.js';
import type { UserId, WorkOrderId } from '../domain/work-order.js';
import {
  SERVICE_NOTE_SETTINGS,
  type ServiceNoteSettings,
} from './service-note.js';
import { type StoreSale, StoreSales } from './work-order-ports.js';
import { WorkOrderQueries, type WorkOrderView } from './work-orders.queries.js';

/** A counter sale linked to a work order, with its state now (ADR-0167). */
export interface LinkedSaleView extends StoreSale {
  readonly linkedBy: UserId;
  readonly linkedAt: Date;
}

/** A work order with its sales as they are now, and what they paid and still owe (UC-WRK-05). */
export interface WorkOrderDetail extends Omit<WorkOrderView, 'sales'> {
  readonly sales: readonly LinkedSaleView[];
  /** The total of the paid sales. */
  readonly paidTotal: Money;
  /** The total of the sales that wait for their payment. */
  readonly unpaidTotal: Money;
}

/** The data of the service note (UC-WRK-06): the work order, the store and the terms. */
export interface ServiceNote extends ServiceNoteSettings {
  readonly workOrder: WorkOrderDetail;
}

/**
 * Reads a work order with the counter sales that pay for it, whose status Ordering gives at the moment of the read
 * (ADR-0167), and the data to print its service note.
 */
@Injectable()
export class WorkOrderReader {
  constructor(
    private readonly queries: WorkOrderQueries,
    private readonly sales: StoreSales,
    @Inject(SERVICE_NOTE_SETTINGS)
    private readonly settings: ServiceNoteSettings,
  ) {}

  /** `null` when it does not exist. */
  async workOrder(id: WorkOrderId): Promise<WorkOrderDetail | null> {
    const view = await this.queries.findWorkOrder(id);
    if (view === null) return null;
    const found = new Map(
      (await this.sales.of(view.sales.map(({ orderId }) => orderId))).map(
        (sale) => [sale.orderId, sale],
      ),
    );
    // Every linked sale is a sale of the store, and orders are never deleted (ADR-0038).
    const sales = view.sales.map(({ orderId, linkedBy, linkedAt }) => ({
      ...found.get(orderId)!,
      linkedBy,
      linkedAt,
    }));
    const totalOf = (payment: StoreSale['payment']) =>
      sales
        .filter((sale) => sale.payment === payment)
        .reduce((total, sale) => total.add(sale.grandTotal), Money.zero('MXN'));
    return {
      ...view,
      sales,
      paidTotal: totalOf('PAID'),
      unpaidTotal: totalOf('PENDING'),
    };
  }

  /** `null` when it does not exist. */
  async serviceNote(id: WorkOrderId): Promise<ServiceNote | null> {
    const workOrder = await this.workOrder(id);
    return workOrder === null ? null : { ...this.settings, workOrder };
  }
}
