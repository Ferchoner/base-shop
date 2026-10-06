import { Injectable } from '@nestjs/common';
import {
  AuditTrail,
  InvalidStateTransitionError,
  NotFoundError,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import type { OrderAddress, OrderId } from '../domain/order.js';
import { OrderRepository } from '../domain/order.repository.js';
import { OrderShipments } from './shipment-ports.js';

/** The personal data of a blocked order, as it was saved (API_SPEC.md §15.7). */
export interface BlockedOrderDataView {
  readonly contactEmail: string;
  /** `null` for an order handed over in the store (ADR-0161). */
  readonly shippingAddress: OrderAddress | null;
  /** `null` for an order without a shipment. */
  readonly shipmentDestination: OrderAddress | null;
}

/**
 * The personal data of a blocked order for a staff member with `orders.read-blocked`, to attend a claim or a
 * requirement (ADR-0070, ADR-0152). Each reading is audited as `orders.read-blocked-data` with its reason and without
 * the values (BR-PRIV-04), in the same transaction: if the audit fails, nothing is answered.
 */
@Injectable()
export class BlockedOrderData {
  constructor(
    private readonly orders: OrderRepository,
    private readonly shipments: OrderShipments,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
  ) {}

  /**
   * @throws NotFoundError for an order that does not exist; InvalidStateTransitionError for one that is not blocked,
   *   whose data the staff already sees, or that was anonymized, which has none left.
   */
  read(input: {
    orderId: OrderId;
    reason: string;
  }): Promise<BlockedOrderDataView> {
    return this.transactions.run(async () => {
      const order = await this.orders.lock(input.orderId);
      if (order === null) throw new NotFoundError('Order', input.orderId);
      const { contactEmail, shippingAddress, status } = order.snapshot;
      // An anonymized order has no email left (ADR-0067).
      if (!order.isBlocked || contactEmail === null) {
        throw new InvalidStateTransitionError(status, 'read blocked data');
      }
      const shipmentDestination = await this.shipments.destinationOf(order.id);
      await this.audit.record({
        action: 'orders.read-blocked-data',
        resource: { type: 'order', id: order.id },
        reason: input.reason,
      });
      return { contactEmail, shippingAddress, shipmentDestination };
    });
  }
}
