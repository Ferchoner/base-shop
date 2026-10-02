import type { DomainEvent } from '../../../shared-kernel/index.js';
import type { OrderId, ShipmentId } from '../domain/shipment.js';

/**
 * Published when a shipment leaves (UC-SHI-05, ADR-0141), at the time it left: Ordering marks its order SHIPPED, and
 * the email of the shipped order (T-215) shows the carrier and tracking number, or own delivery (ADR-0078).
 */
export interface ShipmentDispatched extends DomainEvent<'ShipmentDispatched'> {
  readonly shipmentId: ShipmentId;
  readonly orderId: OrderId;
  readonly carrierName: string | null;
  readonly trackingNumber: string | null;
  readonly ownDelivery: boolean;
}

/**
 * Published when a shipment is delivered (UC-SHI-06, ADR-0141), at the time it was: Ordering marks its order
 * DELIVERED, and SHIPPED first, from `dispatchedAt`, when it was not yet.
 */
export interface ShipmentDelivered extends DomainEvent<'ShipmentDelivered'> {
  readonly shipmentId: ShipmentId;
  readonly orderId: OrderId;
  readonly dispatchedAt: Date;
}
