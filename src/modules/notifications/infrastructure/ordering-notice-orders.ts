import { Injectable } from '@nestjs/common';
import { OrderingFacade } from '../../ordering/index.js';
import {
  type AnonymizedNoticeOrder,
  type NoticeOrder,
  NoticeOrders,
} from '../application/notice-orders.js';

/** The orders of the emails, from the facade of Ordering (ADR-0074, ADR-0143). */
@Injectable()
export class OrderingFacadeNoticeOrders extends NoticeOrders {
  constructor(private readonly ordering: OrderingFacade) {
    super();
  }

  find(orderId: string): Promise<NoticeOrder | AnonymizedNoticeOrder | null> {
    return this.ordering.orderNotice(orderId);
  }
}
