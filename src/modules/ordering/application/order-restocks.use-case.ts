import { Injectable } from '@nestjs/common';
import {
  type AuditEntry,
  AuditTrail,
  NotFoundError,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import type {
  OrderId,
  OrderLineId,
  RestockLine,
  RestockReason,
  StaffId,
} from '../domain/order.js';
import { OrderRepository } from '../domain/order.repository.js';
import { OrderStock, type RestockMovement } from './checkout-ports.js';
import { OrderShipments } from './shipment-ports.js';

/**
 * The audit of a restock (ADR-0052): `orders.restock` of the order, with its reason, what came back of each line
 * and the note of the staff as its reason.
 */
export function restockAudit(
  orderId: OrderId,
  reasonCode: RestockReason,
  lines: readonly RestockLine[],
  note: string | null,
): AuditEntry {
  return {
    action: 'orders.restock',
    resource: { type: 'order', id: orderId },
    changes: {
      reasonCode: { from: null, to: reasonCode },
      lines: {
        from: null,
        to: lines.map(({ orderLineId, quantity }) => ({
          orderLineId,
          quantity,
        })),
      },
    },
    ...(note === null ? {} : { reason: note }),
  };
}

/**
 * The staff brings back to the stock units of lines of an order (UC-INV-09, ADR-0052, ADR-0132, ADR-0142): of a
 * cancelled or refunded order, or of one whose shipment came back. Ordering knows the order, its status and its
 * lines, and Inventory checks what each line sold; the order is locked, so restocks of one order wait for each
 * other, and it never changes.
 */
@Injectable()
export class OrderRestocks {
  constructor(
    private readonly orders: OrderRepository,
    private readonly stock: OrderStock,
    private readonly shipments: OrderShipments,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
  ) {}

  /**
   * Audited as `orders.restock`.
   *
   * @throws NotFoundError; InvalidStateTransitionError when the order does not take a restock for that reason;
   *   UnknownOrderLineError; RestockLimitError when a line would come back beyond what it sold.
   */
  restock(input: {
    orderId: OrderId;
    reasonCode: RestockReason;
    lines: readonly { orderLineId: OrderLineId; quantity: number }[];
    note: string | null;
    actorId: StaffId;
  }): Promise<RestockMovement[]> {
    return this.transactions.run(async () => {
      const order = await this.orders.lock(input.orderId);
      if (order === null) throw new NotFoundError('Order', input.orderId);
      const shipment =
        input.reasonCode === 'SHIPMENT_RETURNED'
          ? (await this.shipments.shipmentsOf([order.id])).get(order.id)
          : undefined;
      order.assertRestockable(input.reasonCode, shipment?.status ?? null);
      const lines = order.linesToRestock(input.lines);
      const movements = await this.stock.restock({
        orderId: order.id,
        reasonCode: input.reasonCode,
        note: input.note,
        actorId: input.actorId,
        lines,
      });
      await this.audit.record(
        restockAudit(order.id, input.reasonCode, lines, input.note),
      );
      return movements;
    });
  }
}
