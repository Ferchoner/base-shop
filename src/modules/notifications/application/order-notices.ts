import { Inject, Injectable, Logger } from '@nestjs/common';
import { EmailSender, type Money } from '../../../shared-kernel/index.js';
import {
  type OrderEmail,
  orderCancelledEmail,
  orderPaidEmail,
  orderPlacedEmail,
  orderShippedEmail,
  refundCompletedEmail,
  type ShipmentLeft,
} from './order-emails.js';
import {
  IN_STORE_PAYMENTS,
  type NoticeOrder,
  NoticeOrders,
} from './notice-orders.js';

/**
 * Emails the buyer of an order about what happened to it (UC-NTF-01, ADR-0074, ADR-0143), once the change
 * commits: to the contact email of the order, never to an anonymized one (BR-NTF-03). At most one email per event
 * and no retries: a failure stays in the log, without the recipient, and never undoes the change (BR-NTF-04).
 */
@Injectable()
export class OrderNotices {
  private readonly logger = new Logger(OrderNotices.name);

  constructor(
    private readonly orders: NoticeOrders,
    private readonly email: EmailSender,
    @Inject(IN_STORE_PAYMENTS) private readonly inStorePayments: boolean,
  ) {}

  orderPlaced(orderId: string): Promise<void> {
    return this.send('order-placed', orderId, (order) =>
      orderPlacedEmail(order, this.inStorePayments),
    );
  }

  orderPaid(orderId: string): Promise<void> {
    return this.send('order-paid', orderId, orderPaidEmail);
  }

  orderShipped(orderId: string, shipment: ShipmentLeft): Promise<void> {
    return this.send('order-shipped', orderId, (order) =>
      orderShippedEmail(order, shipment),
    );
  }

  orderCancelled(orderId: string, refundStarted: boolean): Promise<void> {
    return this.send('order-cancelled', orderId, (order) =>
      orderCancelledEmail(order, refundStarted),
    );
  }

  refundCompleted(orderId: string, amount: Money): Promise<void> {
    return this.send('refund-completed', orderId, (order) =>
      refundCompletedEmail(order, amount),
    );
  }

  private async send(
    kind: string,
    orderId: string,
    write: (order: NoticeOrder) => OrderEmail,
  ): Promise<void> {
    const order = await this.orders.find(orderId);
    if (order === null) {
      this.logger.error(
        `Email ${kind} was not sent: order ${orderId} does not exist`,
      );
      return;
    }
    if (order.contactEmail === null) return;
    try {
      await this.email.send({ to: order.contactEmail, ...write(order) });
    } catch (error) {
      this.logger.warn(
        `Email ${kind} of order ${orderId} was not sent: ${(error as Error).message}`,
      );
    }
  }
}
