import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { eventMetadata, newId } from '../../../shared-kernel/index.js';
import type {
  OrderLifecycle,
  RefundOutcome,
} from '../application/order-lifecycle.use-case.js';
import {
  type RefundCompleted,
  RefundCompletedHandler,
} from './refund-completed.event-handler.js';

const COMPLETED = new Date('2026-10-01T14:00:00.000Z');

function event(): RefundCompleted {
  return {
    ...eventMetadata('RefundCompleted', COMPLETED),
    refundId: newId(),
    paymentId: newId(),
    orderId: newId(),
  };
}

function handler(outcome: RefundOutcome) {
  const received: unknown[] = [];
  const lifecycle = {
    recordRefund: (refund: unknown) => {
      received.push(refund);
      return Promise.resolve(outcome);
    },
  } as unknown as OrderLifecycle;
  return { handler: new RefundCompletedHandler(lifecycle), received };
}

describe('RefundCompletedHandler (ADR-0051, ADR-0135)', () => {
  let error: jest.SpiedFunction<Logger['error']>;

  beforeEach(() => {
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('records the refund of its order, completed when the event happened', async () => {
    const { handler: onEvent, received } = handler('refunded');
    const completed = event();

    await onEvent.onRefundCompleted(completed);

    expect(received).toEqual([
      { orderId: completed.orderId, completedAt: COMPLETED },
    ]);
    expect(error).not.toHaveBeenCalled();
  });

  it('logs an error for a refund of an order that is not a cancelled one with a payment, with the IDs only', async () => {
    const completed = event();

    await handler('unexpected').handler.onRefundCompleted(completed);

    expect(error).toHaveBeenCalledWith(
      `Refund ${completed.refundId} of payment ${completed.paymentId} completed for order ${completed.orderId}, which is not a cancelled one with a payment`,
    );
  });

  it('logs nothing for a repeated event', async () => {
    await handler('already-processed').handler.onRefundCompleted(event());

    expect(error).not.toHaveBeenCalled();
  });
});
