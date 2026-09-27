import { InvalidValueError } from './domain-error.js';
import { type Currency, MAX_MONEY_AMOUNT, Money } from './money.js';

const mxn = (amount: number) => Money.of(amount, 'MXN');

describe('Money', () => {
  describe('of', () => {
    it.each([0, 1, 129900, MAX_MONEY_AMOUNT])('accepts %p cents', (amount) => {
      expect(mxn(amount).amount).toBe(amount);
    });

    it.each([
      ['a negative amount', -1],
      ['a fraction of a cent', 10.5],
      ['an amount above the column limit (ADR-0066)', MAX_MONEY_AMOUNT + 1],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
    ])('rejects %s', (_case, amount) => {
      expect(() => mxn(amount)).toThrow(InvalidValueError);
    });

    it('keeps the currency', () => {
      expect(mxn(100).currency).toBe('MXN');
    });
  });

  it('creates zero', () => {
    expect(Money.zero('MXN').isZero()).toBe(true);
  });

  describe('arithmetic', () => {
    it('adds', () => {
      expect(mxn(119800).add(mxn(9900)).amount).toBe(129700);
    });

    it('rejects a sum above the column limit', () => {
      expect(() => mxn(MAX_MONEY_AMOUNT).add(mxn(1))).toThrow(
        InvalidValueError,
      );
    });

    it('subtracts', () => {
      expect(mxn(129700).subtract(mxn(9900)).amount).toBe(119800);
    });

    it('rejects a subtraction that would be negative', () => {
      expect(() => mxn(100).subtract(mxn(101))).toThrow(InvalidValueError);
    });

    it('multiplies by a quantity to get a line total', () => {
      expect(mxn(59900).multiply(2).amount).toBe(119800);
      expect(mxn(59900).multiply(0).isZero()).toBe(true);
    });

    it.each([
      ['a negative quantity', -1],
      ['a fractional quantity', 1.5],
    ])('rejects %s', (_case, quantity) => {
      expect(() => mxn(100).multiply(quantity)).toThrow(InvalidValueError);
    });

    it('never changes the original amount', () => {
      const price = mxn(100);

      price.add(mxn(50));
      price.multiply(3);

      expect(price.amount).toBe(100);
    });
  });

  describe('containedTax (ADR-0008, ADR-0079, ADR-0094)', () => {
    it.each([
      ['the shipping example of ADR-0079', 9900, 1366],
      ['the products example of ADR-0079', 119800, 16524],
      ['one cent', 1, 0],
      ['zero', 0, 0],
    ])('computes the VAT in %s', (_case, amount, tax) => {
      expect(mxn(amount).containedTax(1600).amount).toBe(tax);
    });

    it('matches the total VAT of the ADR-0079 example', () => {
      const taxTotal = mxn(119800)
        .containedTax(1600)
        .add(mxn(9900).containedTax(1600));

      expect(taxTotal.amount).toBe(17890);
    });

    it('rounds an exact half cent up', () => {
      // 3 × 10000 / 20000 = 1.5 cents. With 16% an exact half cannot happen, so another rate shows it.
      expect(mxn(3).containedTax(10_000).amount).toBe(2);
    });

    it('rounds below half down and above half up', () => {
      // 1 × 5000 / 15000 = 0.33; 2 × 5000 / 15000 = 0.67.
      expect(mxn(1).containedTax(5_000).amount).toBe(0);
      expect(mxn(2).containedTax(5_000).amount).toBe(1);
    });

    it('stays exact with the largest amount', () => {
      // 2147483647 × 1600 / 11600 = 296204640.9655..., rounded up.
      expect(mxn(MAX_MONEY_AMOUNT).containedTax(1600).amount).toBe(296204641);
    });

    it('is zero with a zero rate', () => {
      expect(mxn(9900).containedTax(0).isZero()).toBe(true);
    });

    it.each([
      ['a negative rate', -1],
      ['a fractional rate', 16.5],
      ['a rate above 100%', 10_001],
    ])('rejects %s', (_case, rate) => {
      expect(() => mxn(9900).containedTax(rate)).toThrow(InvalidValueError);
    });
  });

  describe('comparison', () => {
    it('compares amounts', () => {
      const threshold = mxn(150000);

      expect(mxn(160000).greaterThanOrEqual(threshold)).toBe(true);
      expect(mxn(150000).greaterThanOrEqual(threshold)).toBe(true);
      expect(mxn(149999).greaterThanOrEqual(threshold)).toBe(false);
      expect(mxn(149999).lessThan(threshold)).toBe(true);
      expect(mxn(150001).greaterThan(threshold)).toBe(true);
      expect(mxn(150000).lessThanOrEqual(threshold)).toBe(true);
      expect(Math.sign(mxn(1).compareTo(mxn(2)))).toBe(-1);
    });

    it('treats equal amounts in the same currency as equal', () => {
      expect(mxn(100).equals(mxn(100))).toBe(true);
      expect(mxn(100).equals(mxn(101))).toBe(false);
    });
  });

  it('refuses to combine different currencies', () => {
    const dollars = Money.of(100, 'USD' as Currency);

    expect(() => mxn(100).add(dollars)).toThrow(/MXN.*USD/);
    expect(() => mxn(100).compareTo(dollars)).toThrow(/MXN.*USD/);
    expect(mxn(100).equals(dollars)).toBe(false);
  });

  it('serializes as the API Money object (API_SPEC.md §8.1)', () => {
    expect(JSON.stringify({ total: mxn(129900) })).toBe(
      '{"total":{"amount":129900,"currency":"MXN"}}',
    );
  });
});
