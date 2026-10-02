import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../platform/config/environment.js';
import { OrderingModule } from '../ordering/index.js';
import {
  IN_STORE_PAYMENTS,
  NoticeOrders,
} from './application/notice-orders.js';
import { OrderNotices } from './application/order-notices.js';
import { OrderEmailsHandler } from './infrastructure/order-emails.event-handler.js';
import { OrderingFacadeNoticeOrders } from './infrastructure/ordering-notice-orders.js';

/**
 * Notifications (ADR-0004, ADR-0074, ADR-0143): a cross-cutting capability without a domain of its own. It reacts
 * to the events of Ordering, Payments and Shipping and reads the order with the facade of Ordering; no module uses
 * it. Emails go through the `EmailSender` port of the shared kernel (ADR-0110).
 */
@Module({
  imports: [OrderingModule],
  providers: [
    {
      provide: IN_STORE_PAYMENTS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        config.get('MANUAL_PAYMENTS_ENABLED', { infer: true }),
    },
    OrderNotices,
    OrderEmailsHandler,
    { provide: NoticeOrders, useClass: OrderingFacadeNoticeOrders },
  ],
})
export class NotificationsModule {}
