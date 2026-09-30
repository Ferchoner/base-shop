import { Money } from '../../../shared-kernel/index.js';
import type { ShippingMethodSettings } from './shipping-method.js';
import { ShippingRateCalculator } from './shipping-rate-calculator.js';

const mxn = (amount: number) => Money.of(amount, 'MXN');

/** The provisional values of ADR-0092: $99.00, free from $1,500.00. */
const STANDARD: ShippingMethodSettings = {
  name: 'Envío Estándar',
  flatFee: mxn(9_900),
  freeShippingThreshold: mxn(150_000),
  deliveryMinBusinessDays: 3,
  deliveryMaxBusinessDays: 7,
};

const order = (subtotal: number, discount = 0) => ({
  subtotal: mxn(subtotal),
  discount: mxn(discount),
});

const calculator = new ShippingRateCalculator(1_600);

describe('ShippingRateCalculator (UC-SHI-01, BR-SHP-06, BR-SHP-12, ADR-0079)', () => {
  it('charges the flat fee with its VAT inside, as in the example of ADR-0079', () => {
    expect(calculator.charge(STANDARD, order(119_800))).toEqual({
      cost: mxn(9_900),
      taxAmount: mxn(1_366),
      taxRateBp: 1_600,
    });
  });

  it('ships for free from exactly the threshold, with no VAT', () => {
    const free = { cost: mxn(0), taxAmount: mxn(0), taxRateBp: 1_600 };

    expect(calculator.charge(STANDARD, order(150_000))).toEqual(free);
    expect(calculator.charge(STANDARD, order(160_000))).toEqual(free);
    expect(calculator.charge(STANDARD, order(149_999)).cost).toEqual(
      mxn(9_900),
    );
  });

  it('never counts the shipping cost toward the threshold', () => {
    // $1,450.00 plus $99.00 of shipping would pass $1,500.00, but only the goods count.
    expect(calculator.charge(STANDARD, order(145_000)).cost).toEqual(
      mxn(9_900),
    );
  });

  it('compares the threshold with the subtotal minus the discount', () => {
    expect(calculator.charge(STANDARD, order(150_000, 1)).cost).toEqual(
      mxn(9_900),
    );
    expect(calculator.charge(STANDARD, order(160_000, 10_000)).cost).toEqual(
      mxn(0),
    );
  });

  it('always charges the flat fee when there is no free shipping', () => {
    const method = { ...STANDARD, freeShippingThreshold: null };

    expect(calculator.charge(method, order(2_000_000)).cost).toEqual(
      mxn(9_900),
    );
  });

  it('charges nothing, and no VAT, with a flat fee of zero', () => {
    const method = {
      ...STANDARD,
      flatFee: mxn(0),
      freeShippingThreshold: null,
    };

    expect(calculator.charge(method, order(100))).toEqual({
      cost: mxn(0),
      taxAmount: mxn(0),
      taxRateBp: 1_600,
    });
  });

  it('applies the configured rate and reports it (ADR-0027)', () => {
    expect(
      new ShippingRateCalculator(800).charge(STANDARD, order(100)),
    ).toEqual({ cost: mxn(9_900), taxAmount: mxn(733), taxRateBp: 800 });
    expect(
      new ShippingRateCalculator(0).charge(STANDARD, order(100)).taxAmount,
    ).toEqual(mxn(0));
  });
});
