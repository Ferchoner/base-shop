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
      method: null,
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
      method: 'CASH',
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
      method: 'CASH',
      failureCode: null,
      registeredBy: staff,
      createdAt: PAID,
    });
  });

  it('captures by hand only a pending manual payment', () => {
    const captured = start();
    captured.captureManually({
      reference: 'Ticket 1',
      method: null,
      registeredBy: staff,
      now: PAID,
    });

    expect(() =>
      captured.captureManually({
        reference: 'Ticket 2',
        method: null,
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
        method: null,
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
      method: null,
      registeredBy: staff,
      now: PAID,
    });

    expect(saved.snapshot.attempts).toHaveLength(2);
    expect(saved.newAttempts.map(({ status }) => status)).toEqual(['CAPTURED']);
  });
});

describe('Refunds of a payment (UC-PAY-03 and 06, ADR-0051, ADR-0135)', () => {
  const REFUNDED = new Date('2026-10-01T14:00:00.000Z');

  /** A captured manual payment, as saved. */
  function captured(provider: PaymentProvider = 'MANUAL'): Payment {
    const payment = start(provider);
    if (provider === 'MANUAL') {
      payment.captureManually({
        reference: 'Ticket 00452',
        method: null,
        registeredBy: staff,
        now: PAID,
      });
      return Payment.restore(payment.snapshot);
    }
    return Payment.restore({
      ...payment.snapshot,
      status: 'CAPTURED',
      capturedAmount: payment.amount,
    });
  }

  it('cancels a pending payment once, and nothing else', () => {
    const pending = Payment.restore(start().snapshot);
    const paid = captured();

    expect(pending.cancelIfPending()).toBe(true);
    expect(pending.cancelIfPending()).toBe(false);
    expect(paid.cancelIfPending()).toBe(false);

    expect([pending.status, pending.hasChanges]).toEqual(['CANCELLED', true]);
    expect([paid.status, paid.hasChanges]).toEqual(['CAPTURED', false]);
  });

  it('starts the refund of the whole captured amount once (BR-PAY-14)', () => {
    const payment = captured();
    const id = newId<'Refund'>();

    expect(payment.startRefund(id, REFUNDED)).toBe(true);
    expect(payment.startRefund(newId<'Refund'>(), REFUNDED)).toBe(false);

    const refund = {
      id,
      amount: Money.of(19_900, 'MXN'),
      status: 'PENDING',
      providerRefundId: null,
      registeredBy: null,
      createdAt: REFUNDED,
      completedAt: null,
    };
    expect(payment.snapshot.refunds).toEqual([refund]);
    expect(payment.touchedRefunds).toEqual([refund]);
    expect([payment.status, payment.hasChanges]).toEqual(['CAPTURED', true]);
  });

  it('starts a refund only of a captured payment', () => {
    expect(() =>
      Payment.restore(start().snapshot).startRefund(
        newId<'Refund'>(),
        REFUNDED,
      ),
    ).toThrow(new InvalidStateTransitionError('PENDING', 'start a refund'));
  });

  it('completes the pending refund of a manual payment, which is refunded whole', () => {
    const payment = captured();
    const id = newId<'Refund'>();
    payment.startRefund(id, PAID);
    const saved = Payment.restore(payment.snapshot);

    const completed = saved.completeManualRefund({
      reference: 'Devolución 00087',
      registeredBy: staff,
      now: REFUNDED,
    });

    expect(completed).toEqual({
      id,
      amount: Money.of(19_900, 'MXN'),
      status: 'COMPLETED',
      providerRefundId: 'Devolución 00087',
      registeredBy: staff,
      createdAt: PAID,
      completedAt: REFUNDED,
    });
    expect(saved.snapshot).toMatchObject({
      status: 'REFUNDED',
      refundedAmount: Money.of(19_900, 'MXN'),
      refunds: [completed],
    });
    expect(saved.touchedRefunds).toEqual([completed]);
    expect(saved.startRefund(newId<'Refund'>(), REFUNDED)).toBe(false);
    expect(saved.snapshot.refunds).toEqual([completed]);
  });

  it('registers by hand only the pending refund of a manual payment', () => {
    const withoutRefund = captured();
    const paypal = captured('PAYPAL');
    paypal.startRefund(newId<'Refund'>(), PAID);
    const done = captured();
    done.startRefund(newId<'Refund'>(), PAID);
    done.completeManualRefund({
      reference: 'Devolución 1',
      registeredBy: staff,
      now: REFUNDED,
    });
    const input = {
      reference: 'Devolución 2',
      registeredBy: staff,
      now: REFUNDED,
    };

    expect(() => withoutRefund.completeManualRefund(input)).toThrow(
      new InvalidStateTransitionError(
        'CAPTURED',
        'register the refund of a MANUAL payment by hand',
      ),
    );
    expect(() => paypal.completeManualRefund(input)).toThrow(
      InvalidStateTransitionError,
    );
    expect(() => done.completeManualRefund(input)).toThrow(
      new InvalidStateTransitionError(
        'REFUNDED',
        'register the refund of a MANUAL payment by hand',
      ),
    );
  });
});
