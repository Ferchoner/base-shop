import { Money, newId, NotFoundError } from '../../../shared-kernel/index.js';
import {
  CompareAtAmountError,
  type NewPrice,
  type PricePeriod,
  PricePeriodConflictError,
  periodState,
  VariantPrice,
} from './variant-price.js';

const mxn = (amount: number) => Money.of(amount, 'MXN');
const at = (iso: string) => new Date(iso);

const NOW = at('2026-10-01T12:00:00.000Z');
const staffId = newId<'User'>();

const pricesOf = (periods: readonly PricePeriod[] = []) =>
  VariantPrice.of({
    id: newId(),
    priceListId: newId(),
    variantId: newId(),
    periods,
  });

const price = (
  amount: number,
  effectiveFrom: Date | null = null,
  compareAtAmount: number | null = null,
): NewPrice => ({
  id: newId<'PricePeriod'>(),
  amount: mxn(amount),
  compareAtAmount: compareAtAmount === null ? null : mxn(compareAtAmount),
  effectiveFrom,
  createdBy: staffId,
});

const stored = (
  amount: number,
  effectiveFrom: Date,
  effectiveTo: Date | null,
  compareAtAmount: number | null = null,
): PricePeriod => ({
  ...price(amount, effectiveFrom, compareAtAmount),
  effectiveFrom,
  effectiveTo,
  createdAt: effectiveFrom,
});

/** Each period as `amount from → to`, oldest first, to read the line at a glance. */
const line = (variantPrice: VariantPrice) =>
  variantPrice
    .periods()
    .map(
      ({ amount, effectiveFrom, effectiveTo }) =>
        `${amount.amount} ${effectiveFrom.toISOString()} → ${effectiveTo?.toISOString() ?? '∞'}`,
    );

const OCT_1 = at('2026-10-01T06:00:00.000Z');
const NOV_14 = at('2026-11-14T06:00:00.000Z');
const NOV_16 = at('2026-11-16T06:00:00.000Z');
const NOV_18 = at('2026-11-18T06:00:00.000Z');

describe('VariantPrice (UC-PRC-02 to 04, ADR-0125)', () => {
  describe('setting a price from now on', () => {
    it('opens the first period at now, without end', () => {
      const prices = pricesOf();

      const { period, change } = prices.set(price(59_900), NOW);

      expect(change).toBe('set');
      expect(period).toMatchObject({
        amount: mxn(59_900),
        compareAtAmount: null,
        effectiveFrom: NOW,
        effectiveTo: null,
        createdBy: staffId,
        createdAt: NOW,
      });
      expect(prices.at(NOW)).toBe(period);
    });

    it('closes the current period at now (BR-PRC-05)', () => {
      const prices = pricesOf([stored(59_900, OCT_1, null)]);

      prices.set(price(49_900, null, 59_900), NOW);

      expect(line(prices)).toEqual([
        `59900 ${OCT_1.toISOString()} → ${NOW.toISOString()}`,
        `49900 ${NOW.toISOString()} → ∞`,
      ]);
    });

    it('takes a past or present effectiveFrom as now', () => {
      for (const effectiveFrom of [at('2026-09-01T00:00:00.000Z'), NOW]) {
        const prices = pricesOf([stored(59_900, OCT_1, null)]);

        const { period, change } = prices.set(
          price(49_900, effectiveFrom),
          NOW,
        );

        expect(change).toBe('set');
        expect(period.effectiveFrom).toEqual(NOW);
      }
    });

    it('opens nothing for the same price and compare-at price as the current one', () => {
      const current = stored(59_900, OCT_1, null, 79_900);
      const prices = pricesOf([current]);

      const same = prices.set(price(59_900, null, 79_900), NOW);

      expect(same).toEqual({ period: current, change: 'unchanged' });
      expect(prices.changes()).toEqual({ removed: [], ended: [], added: [] });
      expect(prices.set(price(59_900), NOW).change).toBe('set');
    });

    it('ends where the next scheduled period begins', () => {
      const prices = pricesOf([
        stored(59_900, OCT_1, NOV_14),
        stored(49_900, NOV_14, null),
      ]);

      prices.set(price(54_900), NOW);

      expect(line(prices)).toEqual([
        `59900 ${OCT_1.toISOString()} → ${NOW.toISOString()}`,
        `54900 ${NOW.toISOString()} → ${NOV_14.toISOString()}`,
        `49900 ${NOV_14.toISOString()} → ∞`,
      ]);
    });

    it('starts the line now when only scheduled prices exist', () => {
      const prices = pricesOf([stored(49_900, NOV_14, null)]);

      prices.set(price(59_900), NOW);

      expect(line(prices)).toEqual([
        `59900 ${NOW.toISOString()} → ${NOV_14.toISOString()}`,
        `49900 ${NOV_14.toISOString()} → ∞`,
      ]);
    });
  });

  describe('scheduling a price', () => {
    it('closes the period it falls in at its start, and keeps one line without gaps', () => {
      const prices = pricesOf([stored(59_900, OCT_1, null)]);

      expect(prices.set(price(49_900, NOV_14), NOW).change).toBe('scheduled');
      prices.set(price(59_900, NOV_18), NOW);
      prices.set(price(54_900, NOV_16), NOW);

      expect(line(prices)).toEqual([
        `59900 ${OCT_1.toISOString()} → ${NOV_14.toISOString()}`,
        `49900 ${NOV_14.toISOString()} → ${NOV_16.toISOString()}`,
        `54900 ${NOV_16.toISOString()} → ${NOV_18.toISOString()}`,
        `59900 ${NOV_18.toISOString()} → ∞`,
      ]);
    });

    it('ends before the first period when it is scheduled before it', () => {
      const prices = pricesOf([stored(49_900, NOV_16, null)]);

      prices.set(price(59_900, NOV_14), NOW);

      expect(line(prices)).toEqual([
        `59900 ${NOV_14.toISOString()} → ${NOV_16.toISOString()}`,
        `49900 ${NOV_16.toISOString()} → ∞`,
      ]);
    });

    it('schedules even the same price as the current one', () => {
      const prices = pricesOf([stored(59_900, OCT_1, null)]);

      expect(prices.set(price(59_900, NOV_14), NOW).change).toBe('scheduled');
    });

    it('rejects a period that begins at the same instant as another one (BR-PRC-01)', () => {
      const prices = pricesOf([
        stored(59_900, OCT_1, NOV_14),
        stored(49_900, NOV_14, null),
      ]);

      expect(() => prices.set(price(54_900, NOV_14), NOW)).toThrow(
        PricePeriodConflictError,
      );
      expect(prices.changes().added).toEqual([]);
      expect(new PricePeriodConflictError('overlap')).toMatchObject({
        code: 'price-period-conflict',
        category: 'conflict',
        details: { reason: 'overlap' },
      });
    });

    it('changes nothing for the same price scheduled again at the same instant (ADR-0126)', () => {
      const sale = stored(49_900, NOV_14, null, 59_900);
      const prices = pricesOf([stored(59_900, OCT_1, NOV_14), sale]);

      const again = prices.set(price(49_900, NOV_14, 59_900), NOW);

      expect(again).toEqual({ period: sale, change: 'unchanged' });
      expect(prices.changes()).toEqual({ removed: [], ended: [], added: [] });
      expect(() => prices.set(price(49_900, NOV_14), NOW)).toThrow(
        PricePeriodConflictError,
      );
    });

    it('rejects a price from now on when the current period began at this very instant', () => {
      const prices = pricesOf([stored(59_900, NOW, null)]);

      expect(() => prices.set(price(49_900), NOW)).toThrow(
        PricePeriodConflictError,
      );
    });
  });

  it.each([
    ['equal to', 59_900],
    ['below', 49_900],
  ])('rejects a compare-at price %s the price (BR-PRC-03)', (_, compareAt) => {
    const prices = pricesOf();

    expect(() => prices.set(price(59_900, null, compareAt), NOW)).toThrow(
      CompareAtAmountError,
    );
    expect(new CompareAtAmountError().details).toEqual({
      errors: [
        expect.objectContaining({
          field: 'compareAtAmount',
          code: 'compareAtAmount',
        }),
      ],
    });
  });

  describe('cancelling a scheduled price (UC-PRC-04)', () => {
    const scheduledLine = () =>
      pricesOf([
        stored(59_900, OCT_1, NOV_14),
        stored(49_900, NOV_14, NOV_18),
        stored(59_900, NOV_18, null),
      ]);

    it('gives its time back to the period before it', () => {
      const prices = scheduledLine();
      const [, sale] = prices.periods();

      expect(prices.cancel(sale.id, NOW)).toBe(sale);
      expect(line(prices)).toEqual([
        `59900 ${OCT_1.toISOString()} → ${NOV_18.toISOString()}`,
        `59900 ${NOV_18.toISOString()} → ∞`,
      ]);
    });

    it('leaves the period before it without end when it was the last one', () => {
      const prices = scheduledLine();
      const [, , last] = prices.periods();

      prices.cancel(last.id, NOW);

      expect(line(prices)).toEqual([
        `59900 ${OCT_1.toISOString()} → ${NOV_14.toISOString()}`,
        `49900 ${NOV_14.toISOString()} → ∞`,
      ]);
    });

    it('leaves the rest as it is when nothing comes before it', () => {
      const prices = pricesOf([
        stored(49_900, NOV_14, NOV_18),
        stored(59_900, NOV_18, null),
      ]);
      const [first] = prices.periods();

      prices.cancel(first.id, NOW);

      expect(line(prices)).toEqual([`59900 ${NOV_18.toISOString()} → ∞`]);
    });

    it('rejects a period that already began, even at this very instant (BR-PRC-04)', () => {
      const prices = scheduledLine();
      const [current] = prices.periods();

      expect(() => prices.cancel(current.id, NOW)).toThrow(
        PricePeriodConflictError,
      );
      expect(() => prices.cancel(current.id, OCT_1)).toThrow(
        new PricePeriodConflictError('already-started'),
      );
      expect(prices.periods()).toHaveLength(3);
    });

    it('answers a period of another variant as not found', () => {
      expect(() => scheduledLine().cancel(newId(), NOW)).toThrow(NotFoundError);
    });
  });

  describe('changes for the repository', () => {
    it('lists what to delete, end and add, until saved', () => {
      const prices = pricesOf([
        stored(59_900, OCT_1, NOV_14),
        stored(49_900, NOV_14, NOV_18),
        stored(59_900, NOV_18, null),
      ]);
      const [current, sale] = prices.periods();

      prices.cancel(sale.id, NOW);

      expect(prices.changes()).toEqual({
        removed: [sale.id],
        ended: [{ ...current, effectiveTo: NOV_18 }],
        added: [],
      });
      prices.markSaved();
      expect(prices.changes()).toEqual({ removed: [], ended: [], added: [] });

      const { period } = prices.set(price(54_900, NOV_16), NOW);
      expect(prices.changes()).toEqual({
        removed: [],
        ended: [{ ...current, effectiveTo: NOV_16 }],
        added: [period],
      });
    });
  });

  it('keeps the periods oldest first whatever order they are restored in', () => {
    const later = stored(49_900, NOV_14, null);
    const earlier = stored(59_900, OCT_1, NOV_14);

    expect(pricesOf([later, earlier]).periods()).toEqual([earlier, later]);
  });

  it('tells whether a period ended, is in force or has not begun', () => {
    const period = stored(59_900, OCT_1, NOV_14);

    expect(periodState(period, at('2026-09-30T00:00:00.000Z'))).toBe(
      'SCHEDULED',
    );
    expect(periodState(period, OCT_1)).toBe('CURRENT');
    expect(periodState(period, at('2026-11-14T05:59:59.999Z'))).toBe('CURRENT');
    expect(periodState(period, NOV_14)).toBe('PAST');
    expect(periodState(stored(59_900, OCT_1, null), NOV_18)).toBe('CURRENT');
  });
});
