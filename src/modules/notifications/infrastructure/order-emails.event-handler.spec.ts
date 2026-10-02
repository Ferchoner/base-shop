import { eventMetadata, Money } from '../../../shared-kernel/index.js';
import type { OrderNotices } from '../application/order-notices.js';
import { OrderEmailsHandler } from './order-emails.event-handler.js';

const AT = new Date('2026-10-02T12:00:00.000Z');

function handler() {
  const calls: unknown[][] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
      return Promise.resolve();
    };
  const notices = {
    orderPlaced: record('orderPlaced'),
    orderPaid: record('orderPaid'),
    orderShipped: record('orderShipped'),
    orderCancelled: record('orderCancelled'),
    refundCompleted: record('refundCompleted'),
  } as unknown as OrderNotices;
  return { handler: new OrderEmailsHandler(notices), calls };
}

describe('OrderEmailsHandler (UC-NTF-01, ADR-0074, ADR-0143)', () => {
  it('emails each event of the order, its shipment and its refund', async () => {
    const { handler: onEvent, calls } = handler();

    await onEvent.onOrderPlaced({
      ...eventMetadata('OrderPlaced', AT),
      orderId: 'placed',
    });
    await onEvent.onOrderPaid({
      ...eventMetadata('OrderPaid', AT),
      orderId: 'paid',
    });
    await onEvent.onShipmentDispatched({
      ...eventMetadata('ShipmentDispatched', AT),
      orderId: 'shipped',
      carrierName: 'Estafeta',
      trackingNumber: 'EST-0001',
      ownDelivery: false,
    });
    await onEvent.onShipmentDispatched({
      ...eventMetadata('ShipmentDispatched', AT),
      orderId: 'delivered-by-the-store',
      carrierName: null,
      trackingNumber: null,
      ownDelivery: true,
    });
    await onEvent.onOrderCancelled({
      ...eventMetadata('OrderCancelled', AT),
      orderId: 'cancelled',
      refundStarted: true,
    });
    await onEvent.onRefundCompleted({
      ...eventMetadata('RefundCompleted', AT),
      orderId: 'refunded',
      amount: { amount: 19_900, currency: 'MXN' },
    });

    expect(calls).toEqual([
      ['orderPlaced', 'placed'],
      ['orderPaid', 'paid'],
      [
        'orderShipped',
        'shipped',
        {
          carrierName: 'Estafeta',
          trackingNumber: 'EST-0001',
          ownDelivery: false,
        },
      ],
      [
        'orderShipped',
        'delivered-by-the-store',
        { carrierName: null, trackingNumber: null, ownDelivery: true },
      ],
      ['orderCancelled', 'cancelled', true],
      ['refundCompleted', 'refunded', Money.of(19_900, 'MXN')],
    ]);
  });
});
