import { Money, newId } from '../../../shared-kernel/index.js';
import {
  type NewPromotionTerms,
  Promotion,
  type PromotionId,
  type UserId,
} from './promotion.js';
import {
  appliesTo,
  bestDiscount,
  type DiscountableLine,
  discountsOf,
  withMinimumPayment,
} from './promotion-discounts.js';

const NOW = new Date('2026-10-17T18:00:00.000Z');
const HOUR = 3_600_000;
const at = (hours: number) => new Date(NOW.getTime() + hours * HOUR);
const mxn = (amount: number) => Money.of(amount, 'MXN');
const admin = newId<'User'>() as UserId;

const shirt = newId();
const cap = newId();
const linen = newId();
const shirts = newId();
const clothes = newId();

/** A shirt of the brand, in the category of shirts, below the one of clothes. */
const SHIRT: DiscountableLine = {
  lineTotal: mxn(60_000),
  productId: shirt,
  brandId: linen,
  categoryIds: [shirts, clothes],
};

/** A cap without brand nor category. */
const CAP: DiscountableLine = {
  lineTotal: mxn(20_000),
  productId: cap,
  brandId: null,
  categoryIds: [],
};

const TERMS: NewPromotionTerms = {
  name: 'Buen Fin',
  discount: { type: 'PERCENTAGE', percentage: 10 },
  targets: [],
  channels: ['ONLINE', 'STORE'],
  minimumSubtotal: null,
  startsAt: null,
  endsAt: null,
};

const promotion = (terms: Partial<NewPromotionTerms> = {}, created = at(-1)) =>
  Promotion.create({
    id: newId<'Promotion'>() as PromotionId,
    terms: { ...TERMS, ...terms },
    createdBy: admin,
    at: created,
  });

const amounts = (discounts: readonly Money[]) =>
  discounts.map(({ amount }) => amount);

describe('Promotion discounts (T-200 part b, ADR-0168)', () => {
  describe('the lines a promotion applies to', () => {
    it('takes every line for the whole purchase', () => {
      const terms = promotion().snapshot;

      expect([appliesTo(terms, SHIRT), appliesTo(terms, CAP)]).toEqual([
        true,
        true,
      ]);
    });

    it.each([
      ['its product', { type: 'PRODUCT' as const, id: shirt }],
      ['its brand', { type: 'BRAND' as const, id: linen }],
      ['its category', { type: 'CATEGORY' as const, id: shirts }],
      ['a category above its own', { type: 'CATEGORY' as const, id: clothes }],
    ])('takes a line by %s', (_, target) => {
      const terms = promotion({ targets: [target] }).snapshot;

      expect([appliesTo(terms, SHIRT), appliesTo(terms, CAP)]).toEqual([
        true,
        false,
      ]);
    });

    it('takes a line by any of its targets, and never an ID of another type', () => {
      const terms = promotion({
        targets: [
          { type: 'PRODUCT', id: cap },
          { type: 'BRAND', id: shirt },
          { type: 'CATEGORY', id: linen },
        ],
      }).snapshot;

      expect([appliesTo(terms, SHIRT), appliesTo(terms, CAP)]).toEqual([
        false,
        true,
      ]);
    });
  });

  describe('what a percentage takes off', () => {
    it('takes it off each line it applies to, rounding half up by line', () => {
      const terms = promotion({
        discount: { type: 'PERCENTAGE', percentage: 15 },
        targets: [{ type: 'BRAND', id: linen }],
      }).snapshot;
      const odd = { ...SHIRT, lineTotal: mxn(30_003) };

      // 15% of 600.00 is 90.00; of 300.03, 45.0045, so 45.00; the cap has no discount.
      expect(amounts(discountsOf(terms, [SHIRT, odd, CAP]))).toEqual([
        9_000, 4_500, 0,
      ]);
      // 15% of 0.10 is 0.015, which rounds up to 0.02.
      expect(
        amounts(discountsOf(terms, [{ ...SHIRT, lineTotal: mxn(10) }])),
      ).toEqual([2]);
    });

    it('takes the whole line at 100%', () => {
      const terms = promotion({
        discount: { type: 'PERCENTAGE', percentage: 100 },
      }).snapshot;

      expect(amounts(discountsOf(terms, [SHIRT, CAP]))).toEqual([
        60_000, 20_000,
      ]);
    });
  });

  describe('what an amount takes off', () => {
    const amountOff = (amount: number, targets = TERMS.targets) =>
      promotion({
        discount: { type: 'AMOUNT', amount: mxn(amount) },
        targets,
      }).snapshot;

    it('splits it in proportion to the lines it applies to', () => {
      expect(amounts(discountsOf(amountOff(10_000), [SHIRT, CAP]))).toEqual([
        7_500, 2_500,
      ]);
      expect(
        amounts(
          discountsOf(amountOff(10_000, [{ type: 'PRODUCT', id: cap }]), [
            SHIRT,
            CAP,
          ]),
        ),
      ).toEqual([0, 10_000]);
    });

    it('gives the cents left by rounding to the lines of highest total, the first on a tie', () => {
      const lines = [
        { ...CAP, lineTotal: mxn(100) },
        { ...CAP, lineTotal: mxn(300) },
        { ...CAP, lineTotal: mxn(100) },
        { ...CAP, lineTotal: mxn(300) },
      ];

      // 7 cents of 800: 0.875, 2.625, 0.875 and 2.625, so 0, 2, 0 and 2; the 3 left go to the 300s, then the first 100.
      expect(amounts(discountsOf(amountOff(7), lines))).toEqual([1, 3, 0, 3]);
    });

    it('takes off at most what its lines add up to', () => {
      expect(amounts(discountsOf(amountOff(90_000), [SHIRT, CAP]))).toEqual([
        60_000, 20_000,
      ]);
      expect(
        amounts(
          discountsOf(amountOff(90_000, [{ type: 'BRAND', id: linen }]), [
            SHIRT,
            CAP,
          ]),
        ),
      ).toEqual([60_000, 0]);
    });

    it('takes nothing off when it applies to no line', () => {
      expect(
        amounts(
          discountsOf(amountOff(5_000, [{ type: 'PRODUCT', id: newId() }]), [
            SHIRT,
            CAP,
          ]),
        ),
      ).toEqual([0, 0]);
    });

    it('splits large amounts exactly', () => {
      const big = { ...CAP, lineTotal: mxn(2_000_000_000) };

      // Rounded down, 1,999,940,000 and 59,998; the cent left goes to the line of highest total.
      expect(
        amounts(discountsOf(amountOff(1_999_999_999), [big, SHIRT])),
      ).toEqual([1_999_940_001, 59_998]);
    });
  });

  describe('the least the products pay', () => {
    it('leaves one peso, taking back from the line with the highest discount first', () => {
      expect(
        amounts(withMinimumPayment([mxn(60_000), mxn(20_000)], [SHIRT, CAP])),
      ).toEqual([59_900, 20_000]);
      // The peso comes back 60 cents from the second line and 40 from the first.
      expect(
        amounts(
          withMinimumPayment(
            [mxn(50), mxn(60)],
            [
              { ...CAP, lineTotal: mxn(50) },
              { ...CAP, lineTotal: mxn(60) },
            ],
          ),
        ),
      ).toEqual([10, 0]);
    });

    it('takes back from the first line on a tie, and from the next when it runs out', () => {
      const lines = [
        { ...CAP, lineTotal: mxn(70) },
        { ...CAP, lineTotal: mxn(70) },
      ];

      expect(amounts(withMinimumPayment([mxn(70), mxn(70)], lines))).toEqual([
        0, 40,
      ]);
    });

    it('changes nothing when the products already pay one peso', () => {
      expect(
        amounts(withMinimumPayment([mxn(59_900), mxn(0)], [SHIRT, CAP])),
      ).toEqual([59_900, 0]);
      expect(
        amounts(withMinimumPayment([mxn(0), mxn(0)], [SHIRT, CAP])),
      ).toEqual([0, 0]);
    });

    it('takes everything back from products under one peso', () => {
      expect(
        amounts(
          withMinimumPayment([mxn(10)], [{ ...CAP, lineTotal: mxn(90) }]),
        ),
      ).toEqual([0]);
    });
  });

  describe('the promotion an order gets', () => {
    it('is the one that takes off the most, with the products paying one peso', () => {
      const tenPercent = promotion();
      const amount = promotion({
        discount: { type: 'AMOUNT', amount: mxn(5_000) },
      });
      const everything = promotion({
        discount: { type: 'PERCENTAGE', percentage: 100 },
        targets: [{ type: 'PRODUCT', id: cap }],
      });

      const best = bestDiscount(
        [tenPercent, amount, everything],
        [SHIRT, CAP],
        'ONLINE',
        NOW,
      );

      expect(best?.promotion).toBe(everything);
      expect(amounts(best!.discounts)).toEqual([0, 20_000]);
      expect(
        amounts(
          bestDiscount(
            [promotion({ discount: { type: 'PERCENTAGE', percentage: 100 } })],
            [SHIRT, CAP],
            'STORE',
            NOW,
          )!.discounts,
        ),
      ).toEqual([59_900, 20_000]);
    });

    it('is only an active one in the channel of the order', () => {
      const scheduled = promotion({ startsAt: at(1) }, NOW);
      const ended = promotion({ endsAt: NOW }, at(-2));
      const inStore = promotion({ channels: ['STORE'] });
      const online = promotion({ channels: ['ONLINE'] });

      expect(
        bestDiscount([scheduled, ended, inStore], [SHIRT], 'ONLINE', NOW),
      ).toBeNull();
      expect(
        bestDiscount([scheduled, ended, online], [SHIRT], 'STORE', NOW),
      ).toBeNull();
      expect(
        bestDiscount([scheduled, ended, online], [SHIRT], 'ONLINE', NOW)
          ?.promotion,
      ).toBe(online);
    });

    it('needs its minimum purchase, before any discount', () => {
      const reached = promotion({ minimumSubtotal: mxn(80_000) });
      const missed = promotion({
        minimumSubtotal: mxn(80_001),
        discount: { type: 'PERCENTAGE', percentage: 50 },
      });

      expect(
        bestDiscount([missed, reached], [SHIRT, CAP], 'ONLINE', NOW)?.promotion,
      ).toBe(reached);
    });

    it('is none when no promotion takes anything off', () => {
      const elsewhere = promotion({
        targets: [{ type: 'PRODUCT', id: newId() }],
      });

      expect(bestDiscount([elsewhere], [SHIRT], 'ONLINE', NOW)).toBeNull();
      expect(bestDiscount([], [SHIRT], 'ONLINE', NOW)).toBeNull();
      expect(
        bestDiscount(
          [promotion()],
          [{ ...CAP, lineTotal: mxn(100) }],
          'ONLINE',
          NOW,
        ),
      ).toBeNull();
    });

    it('is the one that started first on a tie, then the first by ID', () => {
      const later = promotion({}, at(-1));
      const earlier = promotion({}, at(-2));
      const [first, second] = [
        promotion({}, at(-3)),
        promotion({}, at(-3)),
      ].sort((a, b) => (a.id < b.id ? -1 : 1));

      expect(
        bestDiscount([later, earlier], [SHIRT], 'ONLINE', NOW)?.promotion,
      ).toBe(earlier);
      expect(
        bestDiscount([second, later, first], [SHIRT], 'ONLINE', NOW)?.promotion,
      ).toBe(first);
    });
  });
});
