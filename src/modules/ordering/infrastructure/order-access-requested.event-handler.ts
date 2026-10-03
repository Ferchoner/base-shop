import { Injectable } from '@nestjs/common';
import { OnDomainEvent } from '../../../platform/events/on-domain-event.decorator.js';
import {
  OrderAccessLinks,
  type OrderAccessRequested,
} from '../application/order-access-links.js';

/**
 * Issues and sends the access link that someone asked for (UC-ORD-05, ADR-0148), in the background after the answer
 * (ADR-0098). Running it twice would send a second link that replaces the first; the bus never retries.
 */
@Injectable()
export class OrderAccessRequestedHandler {
  constructor(private readonly links: OrderAccessLinks) {}

  @OnDomainEvent('OrderAccessRequested')
  async onOrderAccessRequested(event: OrderAccessRequested): Promise<void> {
    await this.links.issue(event.contactEmail);
  }
}
