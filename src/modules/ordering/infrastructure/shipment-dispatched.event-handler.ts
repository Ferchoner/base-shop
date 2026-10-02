import { Injectable, Logger } from '@nestjs/common';
import { OnDomainEvent } from '../../../platform/events/on-domain-event.decorator.js';
import { type DomainEvent, toId } from '../../../shared-kernel/index.js';
import { OrderLifecycle } from '../application/order-lifecycle.use-case.js';

/**
 * `ShipmentDispatched` as Ordering reads it (ADR-0141). Shipping publishes it when a shipment leaves, at the time it
 * left; Ordering declares its own type and subscribes by name, so it never imports Shipping's events
 * (ARCHITECTURE.md).
 */
export interface ShipmentDispatched extends DomainEvent<'ShipmentDispatched'> {
  readonly shipmentId: string;
  readonly orderId: string;
}

/**
 * Marks the paid order of a shipment that left as SHIPPED (UC-SHI-05, ADR-0141), in the background after the
 * shipment commits (ADR-0098, API_SPEC.md §2.5). A shipment of an order that is not paid goes to the log, for the
 * staff to look at.
 */
@Injectable()
export class ShipmentDispatchedHandler {
  private readonly logger = new Logger(ShipmentDispatchedHandler.name);

  constructor(private readonly lifecycle: OrderLifecycle) {}

  @OnDomainEvent('ShipmentDispatched')
  async onShipmentDispatched(event: ShipmentDispatched): Promise<void> {
    const outcome = await this.lifecycle.recordShipment({
      orderId: toId<'Order'>(event.orderId),
      dispatchedAt: event.occurredAt,
    });
    if (outcome === 'unexpected') {
      this.logger.error(
        `Shipment ${event.shipmentId} left for order ${event.orderId}, which is not paid`,
      );
    }
  }
}
