import {
  InvalidStateTransitionError,
  InvalidValueError,
  Money,
  newId,
} from '../../../shared-kernel/index.js';
import { Payment, type PaymentProvider } from './payment.js';

const STARTED = new Date('2026-10-01T12:00:00.000Z');
const PAID = new Date('2026-10-01T12:30:00.000Z');
const staff = newId<'User'>();

const start = (
  provider: PaymentProvider = 'MANUAL',
  amount = Money.of(19_900, 'MXN'),
) =>
  Payment.start({
    id: newId<'Payment'>(),
    orderId: newId<'Order'>(),
    orderCode: 'K7M4Q9XA',
    provider,
    amount,
    now: STARTED,
  });

describe('Payment (BR-PAY-01 to 03, ADR-0040, ADR-0055)', () => {
  it('starts pending for the total of the order, with its first attempt', () => {
    const payment = start();

    expect(payment.snapshot).toMatchObject({
      orderCode: 'K7M4Q9XA',
      provider: 'MANUAL',
      status: 'PENDING',
      amount: Money.of(19_900, 'MXN'),
      capturedAmount: Money.zero('MXN'),
      refundedAmount: Money.zero('MXN'),
      providerPaymentId: null,
      capturedAt: null,
      version: 1,
    });
    const attempt = {
      status: 'PENDING',
      providerReference: null,
      failureCode: null,
      registeredBy: null,
      createdAt: STARTED,
    };
    expect(payment.snapshot.attempts).toEqual([attempt]);
    expect(payment.newAttempts).toEqual([attempt]);
  });

  it('needs an amount above zero', () => {
    expect(() => start('MANUAL', Money.zero('MXN'))).toThrow(InvalidValueError);
  });

  it('captures the whole amount when the staff registers a payment made in the store (UC-PAY-02)', () => {
    const payment = start();

    payment.captureManually({
      reference: 'Ticket 00452',
      registeredBy: staff,
      now: PAID,
    });

    expect(payment.snapshot).toMatchObject({
      status: 'CAPTURED',
      capturedAmount: Money.of(19_900, 'MXN'),
      capturedAt: PAID,
    });
    expect(payment.snapshot.attempts.at(-1)).toEqual({
      status: 'CAPTURED',
      providerReference: 'Ticket 00452',
      failureCode: null,
      registeredBy: staff,
      createdAt: PAID,
    });
  });

  it('captures by hand only a pending manual payment', () => {
    const captured = start();
    captured.captureManually({
      reference: 'Ticket 1',
      registeredBy: staff,
      now: PAID,
    });

    expect(() =>
      captured.captureManually({
        reference: 'Ticket 2',
        registeredBy: staff,
        now: PAID,
      }),
    ).toThrow(
      new InvalidStateTransitionError(
        'CAPTURED',
        'capture a MANUAL payment by hand',
      ),
    );
    expect(() =>
      start('PAYPAL').captureManually({
        reference: 'Ticket 3',
        registeredBy: staff,
        now: PAID,
      }),
    ).toThrow(
      new InvalidStateTransitionError(
        'PENDING',
        'capture a PAYPAL payment by hand',
      ),
    );
  });

  it('keeps the attempts it was read with, and adds only the new ones', () => {
    const saved = Payment.restore(start().snapshot);

    expect(saved.newAttempts).toEqual([]);
    saved.captureManually({
      reference: 'Ticket 00452',
      registeredBy: staff,
      now: PAID,
    });

    expect(saved.snapshot.attempts).toHaveLength(2);
    expect(saved.newAttempts.map(({ status }) => status)).toEqual(['CAPTURED']);
  });
});
