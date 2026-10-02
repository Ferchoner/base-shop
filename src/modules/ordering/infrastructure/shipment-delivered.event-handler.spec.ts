import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { eventMetadata, newId } from '../../../shared-kernel/index.js';
import type {
  OrderLifecycle,
  ShipmentOutcome,
} from '../application/order-lifecycle.use-case.js';
import {
  type ShipmentDelivered,
  ShipmentDeliveredHandler,
} from './shipment-delivered.event-handler.js';

const LEFT = new Date('2026-10-02T15:00:00.000Z');
const DELIVERED = new Date('2026-10-03T10:00:00.000Z');

function event(): ShipmentDelivered {
  return {
    ...eventMetadata('ShipmentDelivered', DELIVERED),
    shipmentId: newId(),
    orderId: newId(),
    dispatchedAt: LEFT,
  };
}

function handler(outcome: ShipmentOutcome) {
  const received: unknown[] = [];
  const lifecycle = {
    recordDelivery: (delivery: unknown) => {
      received.push(delivery);
      return Promise.resolve(outcome);
    },
  } as unknown as OrderLifecycle;
  return { handler: new ShipmentDeliveredHandler(lifecycle), received };
}

describe('ShipmentDeliveredHandler (ADR-0141)', () => {
  let error: jest.SpiedFunction<Logger['error']>;

  beforeEach(() => {
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('records that the shipment of its order was delivered when the event happened, and when it left', async () => {
    const { handler: onEvent, received } = handler('moved');
    const delivered = event();

    await onEvent.onShipmentDelivered(delivered);

    expect(received).toEqual([
      {
        orderId: delivered.orderId,
        dispatchedAt: LEFT,
        deliveredAt: DELIVERED,
      },
    ]);
    expect(error).not.toHaveBeenCalled();
  });

  it('logs an error for a shipment of an order that is neither paid nor shipped, with the IDs only', async () => {
    const delivered = event();

    await handler('unexpected').handler.onShipmentDelivered(delivered);

    expect(error).toHaveBeenCalledWith(
      `Shipment ${delivered.shipmentId} was delivered for order ${delivered.orderId}, which is neither paid nor shipped`,
    );
  });

  it('logs nothing for a repeated event', async () => {
    await handler('already-processed').handler.onShipmentDelivered(event());

    expect(error).not.toHaveBeenCalled();
  });
});
