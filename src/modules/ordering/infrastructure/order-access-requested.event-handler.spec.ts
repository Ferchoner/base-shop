import { ON_DOMAIN_EVENT } from '../../../platform/events/on-domain-event.decorator.js';
import { eventMetadata } from '../../../shared-kernel/index.js';
import type { OrderAccessLinks } from '../application/order-access-links.js';
import { OrderAccessRequestedHandler } from './order-access-requested.event-handler.js';

describe('OrderAccessRequestedHandler (UC-ORD-05, ADR-0148)', () => {
  it('subscribes to OrderAccessRequested and issues the link for its email', async () => {
    const issued: string[] = [];
    const links = {
      issue: (contactEmail: string) => {
        issued.push(contactEmail);
        return Promise.resolve();
      },
    } as unknown as OrderAccessLinks;
    const handler = new OrderAccessRequestedHandler(links);

    await handler.onOrderAccessRequested({
      ...eventMetadata(
        'OrderAccessRequested',
        new Date('2026-10-03T12:00:00.000Z'),
      ),
      contactEmail: 'cliente@example.com',
    });

    expect(issued).toEqual(['cliente@example.com']);
    expect(
      Reflect.getMetadata(
        ON_DOMAIN_EVENT,
        OrderAccessRequestedHandler.prototype.onOrderAccessRequested,
      ),
    ).toBe('OrderAccessRequested');
  });
});
