import { eventMetadata, newId } from '../../../shared-kernel/index.js';
import type { OrderLifecycle } from '../application/order-lifecycle.use-case.js';
import {
  type ShipmentReturned,
  ShipmentReturnedHandler,
} from './shipment-returned.event-handler.js';

const RETURNED = new Date('2026-10-05T10:00:00.000Z');

describe('ShipmentReturnedHandler (UC-SHI-09, ADR-0149)', () => {
  it('records that the order of the shipment concluded when the event happened, whatever the outcome', async () => {
    const received: unknown[] = [];
    const lifecycle = {
      recordReturn: (shipment: unknown) => {
        received.push(shipment);
        return Promise.resolve(false);
      },
    } as unknown as OrderLifecycle;
    const returned: ShipmentReturned = {
      ...eventMetadata('ShipmentReturned', RETURNED),
      shipmentId: newId(),
      orderId: newId(),
    };

    await new ShipmentReturnedHandler(lifecycle).onShipmentReturned(returned);

    expect(received).toEqual([
      { orderId: returned.orderId, returnedAt: RETURNED },
    ]);
  });
});
