import { Module } from '@nestjs/common';
import { OrderingModule } from '../ordering/index.js';
import { PaymentsModule } from '../payments/index.js';
import { InStorePayments, NoticeOrders } from './application/notice-orders.js';
import { OrderNotices } from './application/order-notices.js';
import { OrderEmailsHandler } from './infrastructure/order-emails.event-handler.js';
import { OrderingFacadeNoticeOrders } from './infrastructure/ordering-notice-orders.js';
import { PaymentsFacadeInStorePayments } from './infrastructure/payments-in-store-payments.js';

/**
 * Notifications (ADR-0004, ADR-0074, ADR-0143): a cross-cutting capability without a domain of its own. It reacts
 * to the events of Ordering, Payments and Shipping, reads the order with the facade of Ordering, and asks the
 * facade of Payments whether the store takes payments in person (ADR-0162); no module uses it. Emails go through
 * the `EmailSender` port of the shared kernel (ADR-0110).
 */
@Module({
  imports: [OrderingModule, PaymentsModule],
  providers: [
    OrderNotices,
    OrderEmailsHandler,
    { provide: NoticeOrders, useClass: OrderingFacadeNoticeOrders },
    { provide: InStorePayments, useClass: PaymentsFacadeInStorePayments },
  ],
})
export class NotificationsModule {}
