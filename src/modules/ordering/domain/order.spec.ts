import {
  InvalidValueError,
  Money,
  newId,
} from '../../../shared-kernel/index.js';
import {
  type Buyer,
  Order,
  type OrderShipping,
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
        { ...lines[0], lineNumber: 1 },
        { ...lines[1], lineNumber: 2 },
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
