import {
  InvalidStateTransitionError,
  InvalidValueError,
  Money,
  newId,
} from '../../../shared-kernel/index.js';
import {
  type Buyer,
  Order,
  type OrderShipping,
  type OrderStatus,
  orderTotals,
  priceLine,
  type ShippingAddress,
} from './order.js';
import { EmptyCartError } from './ordering-errors.js';
import type { PublicCode } from './public-code.js';

const NOW = new Date('2026-10-01T12:00:00.000Z');
const DUE = new Date('2026-10-01T12:20:00.000Z');
const mxn = (amount: number) => Money.of(amount, 'MXN');

const ADDRESS: ShippingAddress = {
  recipientName: 'María López',
  phone: '4431234567',
  street: 'Av. Madero',
  exteriorNumber: '123',
  interiorNumber: null,
  neighborhood: 'Centro',
  postalCode: '58000',
  stateCode: '16',
  stateName: 'Michoacán de Ocampo',
  municipalityCode: '16053',
  municipalityName: 'Morelia',
  city: null,
  references: null,
  country: 'MX',
};

const SHIPPING: OrderShipping = {
  cost: mxn(9_900),
  taxAmount: mxn(1_366),
  taxRateBp: 1600,
  deliveryMinBusinessDays: 3,
  deliveryMaxBusinessDays: 7,
};

const line = (unitPrice: number, quantity: number) =>
  priceLine(
    {
      variantId: newId<'Variant'>(),
      sku: 'CAM-LIN-AZ-M',
      productName: 'Camisa de lino',
      variantOptions: { talla: 'M' },
      unitPrice: mxn(unitPrice),
      quantity,
    },
    1600,
  );

const guest: Buyer = {
  customerId: null,
  contactEmail: ' Cliente@Example.COM ',
  privacyNoticeVersion: ' 2026-09 ',
};

function place(changes: Partial<Parameters<typeof Order.place>[0]> = {}) {
  return Order.place({
    id: newId<'Order'>(),
    publicCode: 'K7M4Q9XA' as PublicCode,
    buyer: guest,
    lines: [line(59_900, 2)],
    shipping: SHIPPING,
    shippingAddress: ADDRESS,
    reservation: { id: newId<'Reservation'>(), expiresAt: DUE },
    sourceCartId: newId<'Cart'>(),
    now: NOW,
    ...changes,
  });
}

describe('Pricing of an order (ADR-0008, BR-TAX-02, BR-ORD-16)', () => {
  it('works out the total and the VAT it contains for each line, rounded by line', () => {
    expect(line(59_900, 2)).toMatchObject({
      unitPrice: mxn(59_900),
      quantity: 2,
      taxRateBp: 1600,
      lineTotal: mxn(119_800),
      taxAmount: mxn(16_524),
    });
    // 1,000 × 1600 / 11600 = 137.93: rounded by line, not over the order.
    expect(line(1_000, 1).taxAmount).toEqual(mxn(138));
    expect(priceLine(line(1_000, 3), 0).taxAmount).toEqual(mxn(0));
  });

  it('adds the shipping to the lines, with the VAT of both', () => {
    expect(orderTotals([line(59_900, 2), line(1_000, 1)], SHIPPING)).toEqual({
      subtotal: mxn(120_800),
      taxTotal: mxn(16_524 + 138 + 1_366),
      shippingCost: mxn(9_900),
      shippingTaxAmount: mxn(1_366),
      discountTotal: mxn(0),
      grandTotal: mxn(130_700),
    });
    expect(orderTotals([], SHIPPING).grandTotal).toEqual(mxn(9_900));
  });
});

describe('Order (UC-ORD-02, BR-ORD-01 to 03, ADR-0049)', () => {
  it('is placed PENDING_PAYMENT, with its lines numbered and its totals worked out', () => {
    const lines = [line(59_900, 2), line(1_000, 1)];
    const reservation = { id: newId<'Reservation'>(), expiresAt: DUE };
    const sourceCartId = newId<'Cart'>();

    const order = place({ lines, reservation, sourceCartId });

    expect(order.status).toBe('PENDING_PAYMENT');
    expect(order.publicCode).toBe('K7M4Q9XA');
    expect(order.snapshot).toEqual({
      id: order.id,
      publicCode: 'K7M4Q9XA',
      customerId: null,
      contactEmail: 'cliente@example.com',
      privacyNoticeVersion: '2026-09',
      status: 'PENDING_PAYMENT',
      lines: [
        { ...lines[0], id: expect.any(String), lineNumber: 1 },
        { ...lines[1], id: expect.any(String), lineNumber: 2 },
      ],
      totals: orderTotals(lines, SHIPPING),
      shippingTaxRateBp: 1600,
      deliveryMinBusinessDays: 3,
      deliveryMaxBusinessDays: 7,
      shippingAddress: ADDRESS,
      reservationId: reservation.id,
      paymentDueAt: DUE,
      sourceCartId,
      placedAt: NOW,
      paidAt: null,
      cancelledAt: null,
      expiredAt: null,
      refundedAt: null,
      version: 1,
    });
  });

  it("keeps the customer's account email, and the privacy notice only for a guest (ADR-0067)", () => {
    const customerId = newId<'User'>();

    const order = place({
      buyer: { customerId, contactEmail: 'ana@example.com' },
    });

    expect(order.snapshot).toMatchObject({
      customerId,
      contactEmail: 'ana@example.com',
      privacyNoticeVersion: null,
    });
  });

  it('needs at least one line (BR-ORD-01)', () => {
    expect(() => place({ lines: [] })).toThrow(EmptyCartError);
  });

  it('needs a contact email, and the privacy notice of a guest', () => {
    expect(() => place({ buyer: { ...guest, contactEmail: '  ' } })).toThrow(
      InvalidValueError,
    );
    expect(() =>
      place({ buyer: { ...guest, privacyNoticeVersion: ' ' } }),
    ).toThrow(InvalidValueError);
  });
});

describe('Order transitions (REQUIREMENTS.md §3.1, ADR-0133)', () => {
  const LATER = new Date('2026-10-01T13:00:00.000Z');
  const CAPTURED = new Date('2026-10-01T12:30:00.000Z');
  const staff = newId<'User'>();

  /** A saved order in `status`, at version 4. */
  const saved = (status: OrderStatus, paidAt: Date | null = null) =>
    Order.restore({ ...place().snapshot, status, paidAt, version: 4 });

  it('keeps what was saved until something changes', () => {
    const order = saved('PENDING_PAYMENT');

    expect([order.hasChanges, order.statusChanges, order.version]).toEqual([
      false,
      [],
      4,
    ]);
    expect(order.grandTotal).toEqual(mxn(129_700));
  });

  it('cancels an unpaid order, with who and why (UC-ORD-07)', () => {
    const order = saved('PENDING_PAYMENT');

    order.cancel(staff, 'Duplicado', LATER);

    expect(order.snapshot).toMatchObject({
      status: 'CANCELLED',
      cancelledAt: LATER,
      version: 4,
    });
    expect(order.statusChanges).toEqual([
      {
        from: 'PENDING_PAYMENT',
        to: 'CANCELLED',
        actorId: staff,
        reason: 'Duplicado',
        at: LATER,
      },
    ]);
    expect(order.hasChanges).toBe(true);
  });

  it('cancels a paid order, PAID or waiting for stock, keeping its payment (ADR-0135)', () => {
    for (const status of ['PAID', 'AWAITING_MANUAL_FULFILLMENT'] as const) {
      const order = saved(status, CAPTURED);

      order.cancel(staff, 'Sin stock', LATER);

      expect(order.snapshot).toMatchObject({
        status: 'CANCELLED',
        paidAt: CAPTURED,
        cancelledAt: LATER,
      });
      expect(order.statusChanges[0]).toMatchObject({ from: status });
    }
  });

  it('cancels nothing shipped, cancelled or expired (BR-CAN-01)', () => {
    for (const status of [
      'SHIPPED',
      'DELIVERED',
      'CANCELLED',
      'EXPIRED',
      'REFUNDED',
    ] as const) {
      expect(() => saved(status).cancel(staff, 'Duplicado', LATER)).toThrow(
        new InvalidStateTransitionError(status, 'cancel'),
      );
    }
  });

  it('is paid when the payment was captured, from PENDING_PAYMENT or EXPIRED (UC-ORD-09)', () => {
    const pending = saved('PENDING_PAYMENT');
    const expired = saved('EXPIRED');
    const reservation = newId<'Reservation'>();
    const first = pending.snapshot.reservationId;

    pending.markPaid(CAPTURED, LATER);
    expired.markPaid(CAPTURED, LATER, reservation);

    expect(pending.snapshot).toMatchObject({
      status: 'PAID',
      paidAt: CAPTURED,
      reservationId: first,
    });
    expect(expired.snapshot).toMatchObject({
      status: 'PAID',
      reservationId: reservation,
    });
    expect(expired.statusChanges).toEqual([
      { from: 'EXPIRED', to: 'PAID', actorId: null, reason: null, at: LATER },
    ]);
    expect(() => saved('CANCELLED').markPaid(CAPTURED, LATER)).toThrow(
      new InvalidStateTransitionError('CANCELLED', 'mark paid'),
    );
  });

  it('waits for stock after a late payment, already paid (BR-ORD-09)', () => {
    const order = saved('EXPIRED');

    order.awaitManualFulfillment(CAPTURED, LATER);

    expect(order.snapshot).toMatchObject({
      status: 'AWAITING_MANUAL_FULFILLMENT',
      paidAt: CAPTURED,
    });
    expect(order.statusChanges[0]).toMatchObject({
      from: 'EXPIRED',
      to: 'AWAITING_MANUAL_FULFILLMENT',
      actorId: null,
    });
    expect(() => saved('PAID').awaitManualFulfillment(CAPTURED, LATER)).toThrow(
      InvalidStateTransitionError,
    );
  });

  it('is paid once the staff gets the stock, keeping when it was paid (UC-ORD-08)', () => {
    const order = saved('AWAITING_MANUAL_FULFILLMENT', CAPTURED);
    const reservation = newId<'Reservation'>();

    order.fulfillManually(staff, reservation, LATER);

    expect(order.snapshot).toMatchObject({
      status: 'PAID',
      paidAt: CAPTURED,
      reservationId: reservation,
    });
    expect(order.statusChanges[0]).toMatchObject({
      from: 'AWAITING_MANUAL_FULFILLMENT',
      to: 'PAID',
      actorId: staff,
    });
    expect(() =>
      saved('EXPIRED').fulfillManually(staff, reservation, LATER),
    ).toThrow(new InvalidStateTransitionError('EXPIRED', 'retry fulfillment'));
  });

  it('keeps a cancelled order cancelled when a payment arrives, once (ADR-0133)', () => {
    const order = saved('CANCELLED');

    expect(order.recordPaymentAfterCancellation(CAPTURED)).toBe(true);
    expect(order.recordPaymentAfterCancellation(LATER)).toBe(false);

    expect(order.snapshot).toMatchObject({
      status: 'CANCELLED',
      paidAt: CAPTURED,
    });
    expect(order.statusChanges).toEqual([]);
    expect(order.hasChanges).toBe(true);
    expect(
      saved('CANCELLED', CAPTURED).recordPaymentAfterCancellation(LATER),
    ).toBe(false);
    expect(() =>
      saved('PAID').recordPaymentAfterCancellation(CAPTURED),
    ).toThrow(InvalidStateTransitionError);
  });

  it('is refunded once its refund completes, if it was cancelled with a payment (ADR-0051)', () => {
    const REFUNDED = new Date('2026-10-01T14:00:00.000Z');
    const order = saved('CANCELLED', CAPTURED);

    order.markRefunded(REFUNDED, LATER);

    expect(order.snapshot).toMatchObject({
      status: 'REFUNDED',
      refundedAt: REFUNDED,
    });
    expect(order.statusChanges).toEqual([
      {
        from: 'CANCELLED',
        to: 'REFUNDED',
        actorId: null,
        reason: null,
        at: LATER,
      },
    ]);
    for (const other of [
      saved('CANCELLED'),
      saved('PAID', CAPTURED),
      saved('REFUNDED', CAPTURED),
    ]) {
      expect(() => other.markRefunded(REFUNDED, LATER)).toThrow(
        new InvalidStateTransitionError(other.status, 'mark refunded'),
      );
    }
  });

  it('expires an unpaid order once its payment is due, and only once (UC-ORD-10, BR-ORD-07)', () => {
    const early = saved('PENDING_PAYMENT');
    const due = saved('PENDING_PAYMENT');
    const late = saved('PENDING_PAYMENT');

    expect(early.expireIfDue(new Date(DUE.getTime() - 1))).toBe(false);
    expect(due.expireIfDue(DUE)).toBe(true);
    expect(late.expireIfDue(LATER)).toBe(true);
    expect(late.expireIfDue(LATER)).toBe(false);

    expect([early.status, early.hasChanges]).toEqual([
      'PENDING_PAYMENT',
      false,
    ]);
    expect(due.snapshot).toMatchObject({ status: 'EXPIRED', expiredAt: DUE });
    expect(late.statusChanges).toEqual([
      {
        from: 'PENDING_PAYMENT',
        to: 'EXPIRED',
        actorId: null,
        reason: null,
        at: LATER,
      },
    ]);
  });

  it('expires nothing but an unpaid order', () => {
    for (const status of [
      'PAID',
      'AWAITING_MANUAL_FULFILLMENT',
      'SHIPPED',
      'DELIVERED',
      'CANCELLED',
      'EXPIRED',
      'REFUNDED',
    ] as const) {
      const order = saved(status);

      expect(order.expireIfDue(LATER)).toBe(false);
      expect([order.status, order.hasChanges]).toEqual([status, false]);
    }
  });
});

describe('Lines of an order (ADR-0140)', () => {
  it('gives each line its own ID, in the order of the lines', () => {
    const order = place({
      lines: [line(10_000, 1), line(20_000, 2), line(30_000, 3)],
    });

    const ids = order.snapshot.lines.map(({ id }) => id);

    expect(new Set(ids).size).toBe(3);
    expect([...ids].sort()).toEqual(ids);
  });
});
