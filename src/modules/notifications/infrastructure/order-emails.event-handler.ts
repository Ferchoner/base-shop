import { Injectable } from '@nestjs/common';
import { OnDomainEvent } from '../../../platform/events/on-domain-event.decorator.js';
import {
  type Currency,
  type DomainEvent,
  Money,
} from '../../../shared-kernel/index.js';
import { OrderNotices } from '../application/order-notices.js';

// The events as Notifications reads them (ADR-0143): it declares its own types and subscribes by name, so it never
// imports the events of Ordering, Payments nor Shipping (ARCHITECTURE.md).

export interface OrderPlaced extends DomainEvent<'OrderPlaced'> {
  readonly orderId: string;
}

export interface OrderPaid extends DomainEvent<'OrderPaid'> {
  readonly orderId: string;
}

export interface OrderCancelled extends DomainEvent<'OrderCancelled'> {
  readonly orderId: string;
  readonly refundStarted: boolean;
}

export interface ShipmentDispatched extends DomainEvent<'ShipmentDispatched'> {
  readonly orderId: string;
  readonly carrierName: string | null;
  readonly trackingNumber: string | null;
  readonly ownDelivery: boolean;
}

export interface RefundCompleted extends DomainEvent<'RefundCompleted'> {
  readonly orderId: string;
  readonly amount: { readonly amount: number; readonly currency: Currency };
}

/**
 * The emails of the life of an order (UC-NTF-01, ADR-0074), in the background after each change commits (ADR-0098,
 * API_SPEC.md §2.5): received, paid, shipped, cancelled and refunded. None for an expired, delivered or returned
 * order, a failed delivery nor a late payment without stock (BR-NTF-02).
 */
@Injectable()
export class OrderEmailsHandler {
  constructor(private readonly notices: OrderNotices) {}

  @OnDomainEvent('OrderPlaced')
  onOrderPlaced(event: OrderPlaced): Promise<void> {
    return this.notices.orderPlaced(event.orderId);
  }

  @OnDomainEvent('OrderPaid')
  onOrderPaid(event: OrderPaid): Promise<void> {
    return this.notices.orderPaid(event.orderId);
  }

  @OnDomainEvent('ShipmentDispatched')
  onShipmentDispatched(event: ShipmentDispatched): Promise<void> {
    return this.notices.orderShipped(event.orderId, {
      carrierName: event.carrierName,
      trackingNumber: event.trackingNumber,
      ownDelivery: event.ownDelivery,
    });
  }

  @OnDomainEvent('OrderCancelled')
  onOrderCancelled(event: OrderCancelled): Promise<void> {
    return this.notices.orderCancelled(event.orderId, event.refundStarted);
  }

  @OnDomainEvent('RefundCompleted')
  onRefundCompleted(event: RefundCompleted): Promise<void> {
    return this.notices.refundCompleted(
      event.orderId,
      Money.of(event.amount.amount, event.amount.currency),
    );
  }
}
