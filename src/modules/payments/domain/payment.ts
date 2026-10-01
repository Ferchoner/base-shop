import {
  type Id,
  InvalidStateTransitionError,
  InvalidValueError,
  Money,
} from '../../../shared-kernel/index.js';

export type PaymentId = Id<'Payment'>;

export type RefundId = Id<'Refund'>;

/** An order of Ordering, known here only by its ID (ADR-0005). */
export type OrderId = Id<'Order'>;

/** A staff member of Identity, known here only by its ID (ADR-0005). */
export type StaffId = Id<'User'>;

/** ADR-0040: the manual method, for tests, and PayPal, prepared but not enabled (BR-PAY-13). */
export const PAYMENT_PROVIDERS = ['MANUAL', 'PAYPAL'] as const;

export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

/** REQUIREMENTS.md §3.2; transitions are monotonic (BR-PAY-05). */
export const PAYMENT_STATUSES = [
  'PENDING',
  'REQUIRES_ACTION',
  'AUTHORIZED',
  'CAPTURED',
  'FAILED',
  'CANCELLED',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** A try to collect the payment, as the provider or the staff answered it (`payment_attempts`). */
export interface PaymentAttempt {
  readonly status: PaymentStatus;
  /** The receipt of the store, for a manual payment. */
  readonly providerReference: string | null;
  readonly failureCode: string | null;
  /** The staff member who registered a manual payment. */
  readonly registeredBy: StaffId | null;
  readonly createdAt: Date;
}

/** ADR-0051: a refund is started when a paid order is cancelled, and completed when the money goes back. */
export type RefundStatus = 'PENDING' | 'COMPLETED' | 'FAILED';

/** A full refund of a payment (BR-PAY-04, BR-PAY-11, `refunds`). */
export interface Refund {
  readonly id: RefundId;
  readonly amount: Money;
  readonly status: RefundStatus;
  /** The receipt of the refund made outside the system, for a manual payment. */
  readonly providerRefundId: string | null;
  /** The staff member who registered a manual refund. */
  readonly registeredBy: StaffId | null;
  readonly createdAt: Date;
  readonly completedAt: Date | null;
}

export interface PaymentSnapshot {
  readonly id: PaymentId;
  readonly orderId: OrderId;
  /** The public code of the order, without the dash (ADR-0049, ADR-0134). */
  readonly orderCode: string;
  readonly provider: PaymentProvider;
  readonly status: PaymentStatus;
  /** The total of the order, never what a client sends (BR-PAY-02). */
  readonly amount: Money;
  readonly capturedAmount: Money;
  readonly refundedAmount: Money;
  readonly providerPaymentId: string | null;
  readonly capturedAt: Date | null;
  readonly attempts: readonly PaymentAttempt[];
  /** Oldest first; at most one PENDING or COMPLETED (BR-PAY-14). */
  readonly refunds: readonly Refund[];
  readonly version: number;
}

/**
 * The payment of an order (DOMAIN_MODEL.md, Payments): one per order (BR-PAY-01), for its total (BR-PAY-02),
 * captured at once (BR-PAY-03, ADR-0013). Its attempts are a history that only grows, and its refunds give back
 * the whole captured amount, only when its order is cancelled (BR-PAY-11, ADR-0051).
 */
export class Payment {
  private readonly added: PaymentAttempt[] = [];
  private readonly touched = new Set<RefundId>();
  private changed = false;

  private constructor(private state: PaymentSnapshot) {}

  /**
   * A payment started with a provider (UC-PAY-01), waiting to be collected.
   *
   * @throws InvalidValueError for an amount that is not above zero.
   */
  static start(input: {
    id: PaymentId;
    orderId: OrderId;
    orderCode: string;
    provider: PaymentProvider;
    amount: Money;
    now: Date;
  }): Payment {
    if (input.amount.isZero()) {
      throw new InvalidValueError('A payment needs an amount above zero');
    }
    const zero = Money.zero(input.amount.currency);
    const payment = new Payment({
      id: input.id,
      orderId: input.orderId,
      orderCode: input.orderCode,
      provider: input.provider,
      status: 'PENDING',
      amount: input.amount,
      capturedAmount: zero,
      refundedAmount: zero,
      providerPaymentId: null,
      capturedAt: null,
      attempts: [],
      refunds: [],
      version: 1,
    });
    payment.attempt({
      status: 'PENDING',
      providerReference: null,
      failureCode: null,
      registeredBy: null,
      createdAt: input.now,
    });
    return payment;
  }

  /** A payment as it was saved. */
  static restore(snapshot: PaymentSnapshot): Payment {
    return new Payment(snapshot);
  }

  get id(): PaymentId {
    return this.state.id;
  }

  get orderId(): OrderId {
    return this.state.orderId;
  }

  get provider(): PaymentProvider {
    return this.state.provider;
  }

  get status(): PaymentStatus {
    return this.state.status;
  }

  get amount(): Money {
    return this.state.amount;
  }

  get snapshot(): PaymentSnapshot {
    return this.state;
  }

  get version(): number {
    return this.state.version;
  }

  /** The attempts made since the payment was read, for the repository to add. */
  get newAttempts(): readonly PaymentAttempt[] {
    return this.added;
  }

  /** The refunds started or changed since the payment was read, for the repository to write. */
  get touchedRefunds(): readonly Refund[] {
    return this.state.refunds.filter(({ id }) => this.touched.has(id));
  }

  /** Whether anything changed since it was read, so there is something to save. */
  get hasChanges(): boolean {
    return this.changed;
  }

  /**
   * The staff registers a payment made in the store (UC-PAY-02, ADR-0055): the whole amount is captured, with
   * the receipt of the store and who registered it.
   *
   * @throws InvalidStateTransitionError unless it is a pending manual payment.
   */
  captureManually(input: {
    reference: string;
    registeredBy: StaffId;
    now: Date;
  }): void {
    if (this.state.provider !== 'MANUAL' || this.state.status !== 'PENDING') {
      throw new InvalidStateTransitionError(
        this.state.status,
        `capture a ${this.state.provider} payment by hand`,
      );
    }
    this.state = {
      ...this.state,
      status: 'CAPTURED',
      capturedAmount: this.state.amount,
      capturedAt: input.now,
    };
    this.attempt({
      status: 'CAPTURED',
      providerReference: input.reference,
      failureCode: null,
      registeredBy: input.registeredBy,
      createdAt: input.now,
    });
  }

  /**
   * The order was cancelled before the payment was collected (ADR-0135): a pending payment can no longer be
   * captured.
   *
   * @returns false, changing nothing, unless the payment was pending.
   */
  cancelIfPending(): boolean {
    if (this.state.status !== 'PENDING') return false;
    this.state = { ...this.state, status: 'CANCELLED' };
    this.changed = true;
    return true;
  }

  /**
   * Starts the full refund of a captured payment, because its order was cancelled (UC-PAY-03, ADR-0051).
   *
   * @returns false, changing nothing, when a refund is already pending or completed (BR-PAY-14).
   * @throws InvalidStateTransitionError unless the payment was captured.
   */
  startRefund(id: RefundId, now: Date): boolean {
    if (this.activeRefund() !== undefined) return false;
    if (this.state.status !== 'CAPTURED') {
      throw new InvalidStateTransitionError(
        this.state.status,
        'start a refund',
      );
    }
    this.putRefund({
      id,
      amount: this.state.capturedAmount,
      status: 'PENDING',
      providerRefundId: null,
      registeredBy: null,
      createdAt: now,
      completedAt: null,
    });
    return true;
  }

  /**
   * The staff registers the refund of a manual payment, made outside the system (UC-PAY-06, BR-PAY-11): the
   * pending refund is completed, and the whole captured amount is refunded.
   *
   * @returns the completed refund.
   * @throws InvalidStateTransitionError unless it is a manual payment with a pending refund.
   */
  completeManualRefund(input: {
    reference: string;
    registeredBy: StaffId;
    now: Date;
  }): Refund {
    const pending = this.activeRefund();
    if (this.state.provider !== 'MANUAL' || pending?.status !== 'PENDING') {
      throw new InvalidStateTransitionError(
        this.state.status,
        `register the refund of a ${this.state.provider} payment by hand`,
      );
    }
    const completed: Refund = {
      ...pending,
      status: 'COMPLETED',
      providerRefundId: input.reference,
      registeredBy: input.registeredBy,
      completedAt: input.now,
    };
    this.putRefund(completed);
    this.state = {
      ...this.state,
      status: 'REFUNDED',
      refundedAmount: pending.amount,
    };
    return completed;
  }

  /** The refund in progress or completed, if any (BR-PAY-14). */
  private activeRefund(): Refund | undefined {
    return this.state.refunds.find(
      ({ status }) => status === 'PENDING' || status === 'COMPLETED',
    );
  }

  private putRefund(refund: Refund): void {
    const others = this.state.refunds.filter(({ id }) => id !== refund.id);
    this.state = { ...this.state, refunds: [...others, refund] };
    this.touched.add(refund.id);
    this.changed = true;
  }

  private attempt(attempt: PaymentAttempt): void {
    this.changed = true;
    this.added.push(attempt);
    this.state = {
      ...this.state,
      attempts: [...this.state.attempts, attempt],
    };
  }
}
