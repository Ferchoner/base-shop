import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { eventMetadata, newId } from '../../../shared-kernel/index.js';
import type {
  CartRestoration,
  RestorationOutcome,
} from '../application/cart-restoration.use-case.js';
import {
  type OrderExpired,
  OrderExpiredHandler,
} from './order-expired.event-handler.js';

const EXPIRED = new Date('2026-10-01T12:21:00.000Z');

function event(customerId: string | null = newId()): OrderExpired {
  return {
    ...eventMetadata('OrderExpired', EXPIRED),
    orderId: newId(),
    customerId,
    sourceCartId: newId(),
    lines: [{ variantId: newId(), quantity: 2 }],
  };
}

function handler(outcome: RestorationOutcome) {
  const received: unknown[] = [];
  const restoration = {
    restoreExpiredOrder: (order: unknown) => {
      received.push(order);
      return Promise.resolve(outcome);
    },
  } as unknown as CartRestoration;
  return { handler: new OrderExpiredHandler(restoration), received };
}

describe('OrderExpiredHandler (UC-CRT-08, ADR-0137)', () => {
  let error: jest.SpiedFunction<Logger['error']>;

  beforeEach(() => {
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('restores the lines of the order in its buyer’s cart, as of when it expired', async () => {
    for (const expired of [event(), event(null)]) {
      const { handler: onEvent, received } = handler('reactivated');

      await onEvent.onOrderExpired(expired);

      expect(received).toEqual([
        {
          customerId: expired.customerId,
          sourceCartId: expired.sourceCartId,
          lines: expired.lines,
          expiredAt: EXPIRED,
        },
      ]);
    }
    expect(error).not.toHaveBeenCalled();
  });

  it('logs a cart that does not exist or is not the buyer’s, with the IDs only', async () => {
    const expired = event();

    await handler('unexpected').handler.onOrderExpired(expired);

    expect(error).toHaveBeenCalledWith(
      `Cart ${expired.sourceCartId} of expired order ${expired.orderId} does not exist or is not its buyer's: its lines were not restored`,
    );
  });

  it('restores nothing, and logs nothing, for an order without a cart, placed by the staff in the store (ADR-0161)', async () => {
    const { handler: onEvent, received } = handler('unexpected');

    await onEvent.onOrderExpired({ ...event(), sourceCartId: null });

    expect(received).toEqual([]);
    expect(error).not.toHaveBeenCalled();
  });

  it('logs nothing for a repeated event', async () => {
    await handler('already-restored').handler.onOrderExpired(event());

    expect(error).not.toHaveBeenCalled();
  });
});
