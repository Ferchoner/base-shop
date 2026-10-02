import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { eventMetadata, newId } from '../../../shared-kernel/index.js';
import type {
  OrderLifecycle,
  ShipmentOutcome,
} from '../application/order-lifecycle.use-case.js';
import {
  type ShipmentDispatched,
  ShipmentDispatchedHandler,
} from './shipment-dispatched.event-handler.js';

const LEFT = new Date('2026-10-02T15:00:00.000Z');

function event(): ShipmentDispatched {
  return {
    ...eventMetadata('ShipmentDispatched', LEFT),
    shipmentId: newId(),
    orderId: newId(),
  };
}

function handler(outcome: ShipmentOutcome) {
  const received: unknown[] = [];
  const lifecycle = {
    recordShipment: (shipment: unknown) => {
      received.push(shipment);
      return Promise.resolve(outcome);
    },
  } as unknown as OrderLifecycle;
  return { handler: new ShipmentDispatchedHandler(lifecycle), received };
}

describe('ShipmentDispatchedHandler (ADR-0141)', () => {
  let error: jest.SpiedFunction<Logger['error']>;

  beforeEach(() => {
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('records that the shipment of its order left, when the event happened', async () => {
    const { handler: onEvent, received } = handler('moved');
    const dispatched = event();

    await onEvent.onShipmentDispatched(dispatched);

    expect(received).toEqual([
      { orderId: dispatched.orderId, dispatchedAt: LEFT },
    ]);
    expect(error).not.toHaveBeenCalled();
  });

  it('logs an error for a shipment of an order that is not paid, with the IDs only', async () => {
    const dispatched = event();

    await handler('unexpected').handler.onShipmentDispatched(dispatched);

    expect(error).toHaveBeenCalledWith(
      `Shipment ${dispatched.shipmentId} left for order ${dispatched.orderId}, which is not paid`,
    );
  });

  it('logs nothing for a repeated event', async () => {
    await handler('already-processed').handler.onShipmentDispatched(event());

    expect(error).not.toHaveBeenCalled();
  });
});
