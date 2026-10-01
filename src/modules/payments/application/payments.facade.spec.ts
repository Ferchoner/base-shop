import {
  type AuditEntry,
  type AuditTrail,
  type DomainEvent,
  type DomainEventPublisher,
  InvalidStateTransitionError,
  Money,
  newId,
  type TransactionManager,
} from '../../../shared-kernel/index.js';
import {
  type OrderId,
  Payment,
  type PaymentProvider,
} from '../domain/payment.js';
import {
  ManualPaymentsDisabledError,
  ProviderNotEnabledError,
} from '../domain/payment-errors.js';
import { PaymentRepository } from '../domain/payment.repository.js';
import { type PaymentRequest, PaymentsFacade } from './payments.facade.js';
import type { PaymentsQueries, PaymentView } from './payments.queries.js';

// Test doubles of the unit tests of Payments' facade.

const NOW = new Date('2026-10-01T12:00:00.000Z');
const staff = newId<'User'>();

/** Payments in memory: `inserted` and `saved` keep what was written. */
class InMemoryPayments extends PaymentRepository {
  readonly inserted: Payment[] = [];
  readonly saved: Payment[] = [];

  constructor(private readonly existing: Payment | null = null) {
    super();
  }

  findByOrder(): Promise<Payment | null> {
    return Promise.resolve(
      this.existing === null ? null : Payment.restore(this.existing.snapshot),
    );
  }

  insert(payment: Payment, now: Date): Promise<void> {
    expect(now).toBe(NOW);
    this.inserted.push(payment);
    return Promise.resolve();
  }

  save(payment: Payment, now: Date): Promise<void> {
    expect(now).toBe(NOW);
    this.saved.push(payment);
    return Promise.resolve();
  }
}

const order: PaymentRequest = {
  orderId: newId<'Order'>(),
  orderCode: 'K7M4Q9XA',
  amount: Money.of(19_900, 'MXN'),
};

function existing(provider: PaymentProvider, captured = false): Payment {
  const payment = Payment.start({
    id: newId<'Payment'>(),
    orderId: order.orderId as OrderId,
    orderCode: order.orderCode,
    provider,
    amount: order.amount,
    now: NOW,
  });
  if (captured) {
    payment.captureManually({
      reference: 'Ticket 1',
      registeredBy: staff,
      now: NOW,
    });
  }
  return Payment.restore(payment.snapshot);
}

function setUp(options: { existing?: Payment; manual?: boolean } = {}) {
  const payments = new InMemoryPayments(options.existing ?? null);
  const views: OrderId[][] = [];
  const queries = {
    paymentsOf: (ids: readonly OrderId[]) => {
      views.push([...ids]);
      const payment =
        [...payments.inserted, ...payments.saved].at(-1) ?? options.existing;
      return Promise.resolve(
        new Map(
          payment === undefined
            ? []
            : [[payment.orderId, { id: payment.id } as unknown as PaymentView]],
        ),
      );
    },
  } as unknown as PaymentsQueries;
  const published: DomainEvent[] = [];
  const events = {
    publish: (...all: DomainEvent[]) => published.push(...all),
  } as unknown as DomainEventPublisher;
  const audited: AuditEntry[] = [];
  const audit = {
    record: (entry: AuditEntry) => {
      audited.push(entry);
      return Promise.resolve();
    },
  } as unknown as AuditTrail;
  const inline = {
    run: <T>(work: () => Promise<T>) => work(),
  } as unknown as TransactionManager;
  const facade = new PaymentsFacade(
    payments,
    queries,
    events,
    audit,
    inline,
    { now: () => NOW },
    options.manual ?? true,
  );
  return { facade, payments, published, audited, views };
}

describe('PaymentsFacade: starting a payment (UC-PAY-01)', () => {
  it('enables the manual method only when its variable turns it on, and PayPal never (BR-PAY-13)', () => {
    expect(() => setUp().facade.assertProviderEnabled('MANUAL')).not.toThrow();
    expect(() =>
      setUp({ manual: false }).facade.assertProviderEnabled('MANUAL'),
    ).toThrow(new ProviderNotEnabledError('MANUAL'));
    expect(() => setUp().facade.assertProviderEnabled('PAYPAL')).toThrow(
      new ProviderNotEnabledError('PAYPAL'),
    );
  });

  it('starts a payment for the total of the order and tells to pay in the store', async () => {
    const { facade, payments, views } = setUp();

    const start = await facade.start(order, 'MANUAL');

    expect(payments.inserted).toHaveLength(1);
    expect(payments.inserted[0].snapshot).toMatchObject({
      orderId: order.orderId,
      orderCode: 'K7M4Q9XA',
      provider: 'MANUAL',
      status: 'PENDING',
      amount: order.amount,
    });
    expect(start).toEqual({
      payment: { id: payments.inserted[0].id },
      action: {
        type: 'PAY_IN_STORE',
        orderCode: 'K7M4Q9XA',
        amount: order.amount,
        instructions: 'Presenta este código en la tienda para pagar.',
      },
      started: true,
    });
    expect(views).toEqual([[order.orderId]]);
  });

  it('answers the payment already started with the same provider, writing nothing', async () => {
    const payment = existing('MANUAL');
    const { facade, payments } = setUp({ existing: payment });

    const start = await facade.start(order, 'MANUAL');

    expect(start.started).toBe(false);
    expect(start.payment).toEqual({ id: payment.id });
    expect([payments.inserted, payments.saved]).toEqual([[], []]);
  });

  it('answers 409 for a payment with another provider or no longer pending', async () => {
    const other = setUp({ existing: existing('PAYPAL') });
    const captured = setUp({ existing: existing('MANUAL', true) });

    await expect(other.facade.start(order, 'MANUAL')).rejects.toThrow(
      new InvalidStateTransitionError('PENDING', 'start a MANUAL payment'),
    );
    await expect(captured.facade.start(order, 'MANUAL')).rejects.toThrow(
      new InvalidStateTransitionError('CAPTURED', 'start a MANUAL payment'),
    );
  });

  it('rejects a provider that is not enabled before reading anything', async () => {
    const { facade, views } = setUp({ manual: false });

    await expect(facade.start(order, 'MANUAL')).rejects.toThrow(
      ProviderNotEnabledError,
    );
    expect(views).toEqual([]);
  });
});

describe('PaymentsFacade: a payment made in the store (UC-PAY-02)', () => {
  const capture = (facade: PaymentsFacade, note: string | null = 'Efectivo') =>
    facade.captureManually(order, {
      reference: 'Ticket 00452',
      note,
      registeredBy: staff,
    });

  it('creates and captures the payment when the customer never started it, audits it and publishes PaymentCaptured', async () => {
    const { facade, payments, published, audited } = setUp();

    await capture(facade);

    const [payment] = payments.inserted;
    expect(payment.snapshot).toMatchObject({
      status: 'CAPTURED',
      capturedAt: NOW,
    });
    expect(payment.newAttempts.map(({ status }) => status)).toEqual([
      'PENDING',
      'CAPTURED',
    ]);
    expect(audited).toEqual([
      {
        action: 'payments.manual-capture',
        resource: { type: 'payment', id: payment.id },
        changes: { status: { from: 'PENDING', to: 'CAPTURED' } },
        reason: 'Efectivo',
      },
    ]);
    expect(published).toEqual([
      {
        eventId: expect.any(String),
        eventType: 'PaymentCaptured',
        occurredAt: NOW,
        paymentId: payment.id,
        orderId: order.orderId,
        amount: order.amount,
      },
    ]);
  });

  it('captures the payment the customer started, and audits without a note', async () => {
    const { facade, payments, audited } = setUp({
      existing: existing('MANUAL'),
    });

    await capture(facade, null);

    expect(payments.inserted).toEqual([]);
    expect(payments.saved[0].newAttempts.map(({ status }) => status)).toEqual([
      'CAPTURED',
    ]);
    expect(audited[0]).not.toHaveProperty('reason');
  });

  it('answers 403 when manual payments are off, and 409 for a payment already captured, publishing nothing', async () => {
    const off = setUp({ manual: false });
    const captured = setUp({ existing: existing('MANUAL', true) });

    await expect(capture(off.facade)).rejects.toThrow(
      ManualPaymentsDisabledError,
    );
    expect(() => off.facade.assertManualPaymentsEnabled()).toThrow(
      ManualPaymentsDisabledError,
    );
    await expect(capture(captured.facade)).rejects.toThrow(
      InvalidStateTransitionError,
    );
    for (const { payments, published, audited } of [off, captured]) {
      expect([payments.inserted, payments.saved, published, audited]).toEqual([
        [],
        [],
        [],
        [],
      ]);
    }
  });
});
