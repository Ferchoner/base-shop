import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { eventMetadata, Money, newId } from '../../../shared-kernel/index.js';
import type {
  OrderLifecycle,
  PaymentOutcome,
} from '../application/order-lifecycle.use-case.js';
import {
  type PaymentCaptured,
  PaymentCapturedHandler,
} from './payment-captured.event-handler.js';

const CAPTURED = new Date('2026-10-01T12:30:00.000Z');

function event(): PaymentCaptured {
  return {
    ...eventMetadata('PaymentCaptured', CAPTURED),
    paymentId: newId(),
    orderId: newId(),
    amount: { amount: 129_700, currency: 'MXN' },
  };
}

function handler(outcome: PaymentOutcome) {
  const received: unknown[] = [];
  const lifecycle = {
    recordPayment: (payment: unknown) => {
      received.push(payment);
      return Promise.resolve(outcome);
    },
  } as unknown as OrderLifecycle;
  return { handler: new PaymentCapturedHandler(lifecycle), received };
}

describe('PaymentCapturedHandler (UC-ORD-09, ADR-0133)', () => {
  let error: jest.SpiedFunction<Logger['error']>;
  let warn: jest.SpiedFunction<Logger['warn']>;

  beforeEach(() => {
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('records the payment of its order, captured when the event happened', async () => {
    const { handler: onEvent, received } = handler('paid');
    const captured = event();

    await onEvent.onPaymentCaptured(captured);

    expect(received).toEqual([
      {
        orderId: captured.orderId,
        amount: Money.of(129_700, 'MXN'),
        capturedAt: CAPTURED,
      },
    ]);
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('logs an error for a payment that does not match the total, with the IDs only', async () => {
    const captured = event();

    await handler('amount-mismatch').handler.onPaymentCaptured(captured);

    expect(error).toHaveBeenCalledWith(
      `Payment ${captured.paymentId} does not match the total of order ${captured.orderId}; the order was not marked paid (BR-ORD-08)`,
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns of a payment of a cancelled order, which waits for its refund', async () => {
    const captured = event();

    await handler('recorded-on-cancelled').handler.onPaymentCaptured(captured);

    expect(warn).toHaveBeenCalledWith(
      `Payment ${captured.paymentId} was captured for cancelled order ${captured.orderId}, which now waits for its refund`,
    );
    expect(error).not.toHaveBeenCalled();
  });

  it('logs nothing for the other outcomes', async () => {
    for (const outcome of [
      'awaiting-manual-fulfillment',
      'already-processed',
    ] as const) {
      await handler(outcome).handler.onPaymentCaptured(event());
    }

    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});
