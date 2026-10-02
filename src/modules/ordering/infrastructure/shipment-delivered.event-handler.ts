import { Injectable, Logger } from '@nestjs/common';
import { OnDomainEvent } from '../../../platform/events/on-domain-event.decorator.js';
import { type DomainEvent, toId } from '../../../shared-kernel/index.js';
import { OrderLifecycle } from '../application/order-lifecycle.use-case.js';

/**
 * `ShipmentDelivered` as Ordering reads it (ADR-0141). Shipping publishes it when a shipment is delivered, at the
 * time it was, with when it left; Ordering declares its own type and subscribes by name (ARCHITECTURE.md).
 */
export interface ShipmentDelivered extends DomainEvent<'ShipmentDelivered'> {
  readonly shipmentId: string;
  readonly orderId: string;
  readonly dispatchedAt: Date;
}

/**
 * Marks the order of a delivered shipment as DELIVERED (UC-SHI-06, ADR-0141), in the background after the shipment
 * commits (ADR-0098, API_SPEC.md §2.5), and SHIPPED first when the event of its dispatch is late or was lost. A
 * shipment of an order that is neither paid nor shipped goes to the log, for the staff to look at.
 */
@Injectable()
export class ShipmentDeliveredHandler {
  private readonly logger = new Logger(ShipmentDeliveredHandler.name);

  constructor(private readonly lifecycle: OrderLifecycle) {}

  @OnDomainEvent('ShipmentDelivered')
  async onShipmentDelivered(event: ShipmentDelivered): Promise<void> {
    const outcome = await this.lifecycle.recordDelivery({
      orderId: toId<'Order'>(event.orderId),
      dispatchedAt: event.dispatchedAt,
      deliveredAt: event.occurredAt,
    });
    if (outcome === 'unexpected') {
      this.logger.error(
        `Shipment ${event.shipmentId} was delivered for order ${event.orderId}, which is neither paid nor shipped`,
      );
    }
  }
}
