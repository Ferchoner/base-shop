import { Injectable } from '@nestjs/common';
import { OnDomainEvent } from '../../../platform/events/on-domain-event.decorator.js';
import { type DomainEvent, toId } from '../../../shared-kernel/index.js';
import { OrderLifecycle } from '../application/order-lifecycle.use-case.js';

/**
 * `ShipmentReturned` as Ordering reads it (ADR-0151). Shipping publishes it when the goods of a failed delivery come
 * back, at the time they did; Ordering declares its own type and subscribes by name (ARCHITECTURE.md).
 */
export interface ShipmentReturned extends DomainEvent<'ShipmentReturned'> {
  readonly shipmentId: string;
  readonly orderId: string;
}

/**
 * Records that the SHIPPED order of a returned shipment concluded then (UC-SHI-09, ADR-0145), so the retention of the
 * data of its buyer starts (ADR-0151), in the background after the shipment commits (ADR-0098, ADR-0150).
 */
@Injectable()
export class ShipmentReturnedHandler {
  constructor(private readonly lifecycle: OrderLifecycle) {}

  @OnDomainEvent('ShipmentReturned')
  async onShipmentReturned(event: ShipmentReturned): Promise<void> {
    await this.lifecycle.recordReturn({
      orderId: toId<'Order'>(event.orderId),
      returnedAt: event.occurredAt,
    });
  }
}
