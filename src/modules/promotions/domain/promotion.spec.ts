import {
  InvalidStateTransitionError,
  InvalidValueError,
  Money,
  newId,
} from '../../../shared-kernel/index.js';
import {
  type NewPromotionTerms,
  Promotion,
  type PromotionId,
  promotionStatus,
  type PromotionTarget,
  type UserId,
} from './promotion.js';
import { PromotionEndError } from './promotion-errors.js';

const NOW = new Date('2026-10-16T18:00:00.000Z');
const HOUR = 3_600_000;
const at = (hours: number) => new Date(NOW.getTime() + hours * HOUR);
const admin = newId<'User'>() as UserId;

const shirt: PromotionTarget = { type: 'PRODUCT', id: newId() };
const shirts: PromotionTarget = { type: 'CATEGORY', id: newId() };
const brand: PromotionTarget = { type: 'BRAND', id: newId() };

const TERMS: NewPromotionTerms = {
  name: 'Buen Fin 10%',
  discount: { type: 'PERCENTAGE', percentage: 10 },
  targets: [shirt, shirts],
  channels: ['ONLINE', 'STORE'],
  minimumSubtotal: Money.of(50_000, 'MXN'),
  startsAt: at(24),
  endsAt: at(96),
};

const create = (terms: Partial<NewPromotionTerms> = {}, now = NOW) =>
  Promotion.create({
    id: newId<'Promotion'>() as PromotionId,
    terms: { ...TERMS, ...terms },
    createdBy: admin,
    at: now,
  });

/** A promotion that started an hour ago and ends in three days. */
const started = () => create({ startsAt: at(-1) }, at(-2));

describe('Promotion (ADR-0168)', () => {
  describe('creating it (UC-PRM-01)', () => {
    it('keeps its terms, with a future start, version 1 and nobody who ended it', () => {
      const promotion = create();

      expect(promotion.snapshot).toEqual({
        id: promotion.id,
        ...TERMS,
        createdBy: admin,
        endedAt: null,
        endedBy: null,
        version: 1,
      });
      expect(promotion.statusAt(NOW)).toBe('SCHEDULED');
      expect(promotion.targetsChanged).toBe(false);
    });

    it('starts now without a start, or with one already past', () => {
      expect(create({ startsAt: null }).snapshot.startsAt).toEqual(NOW);
      expect(create({ startsAt: at(-5) }).snapshot.startsAt).toEqual(NOW);
      expect(create({ startsAt: null }).statusAt(NOW)).toBe('ACTIVE');
    });

    it('trims the name and keeps the channels in their order, each once', () => {
      const promotion = create({
        name: '  Buen Fin  ',
        channels: ['STORE', 'ONLINE', 'STORE'],
      });

      expect(promotion.snapshot.name).toBe('Buen Fin');
      expect(promotion.snapshot.channels).toEqual(['ONLINE', 'STORE']);
    });

    it('takes a whole purchase, an amount and no end or minimum', () => {
      const promotion = create({
        discount: { type: 'AMOUNT', amount: Money.of(1, 'MXN') },
        targets: [],
        channels: ['STORE'],
        minimumSubtotal: null,
        endsAt: null,
      });

      expect(promotion.snapshot).toMatchObject({
        discount: { type: 'AMOUNT', amount: Money.of(1, 'MXN') },
        targets: [],
        channels: ['STORE'],
        minimumSubtotal: null,
        endsAt: null,
      });
    });

    it('takes whole percentages from 1 to 100', () => {
      for (const percentage of [1, 100]) {
        expect(
          create({ discount: { type: 'PERCENTAGE', percentage } }).snapshot
            .discount,
        ).toEqual({ type: 'PERCENTAGE', percentage });
      }
      for (const percentage of [0, 101, 12.5]) {
        expect(() =>
          create({ discount: { type: 'PERCENTAGE', percentage } }),
        ).toThrow(
          new InvalidValueError('A percentage is a whole number from 1 to 100'),
        );
      }
    });

    it('refuses an amount or a minimum purchase of 0', () => {
      expect(() =>
        create({ discount: { type: 'AMOUNT', amount: Money.of(0, 'MXN') } }),
      ).toThrow(new InvalidValueError('A discount is more than 0'));
      expect(() => create({ minimumSubtotal: Money.of(0, 'MXN') })).toThrow(
        new InvalidValueError('A minimum purchase is more than 0'),
      );
      expect(
        create({ minimumSubtotal: Money.of(1, 'MXN') }).snapshot
          .minimumSubtotal,
      ).toEqual(Money.of(1, 'MXN'));
    });

    it('takes a name of 1 to 120 characters', () => {
      expect(create({ name: 'x'.repeat(120) }).snapshot.name).toHaveLength(120);
      for (const name of ['   ', 'x'.repeat(121)]) {
        expect(() => create({ name })).toThrow(
          new InvalidValueError('A name has 1 to 120 characters'),
        );
      }
    });

    it('takes up to 100 targets, each once', () => {
      const many = (count: number): PromotionTarget[] =>
        Array.from({ length: count }, () => ({ type: 'BRAND', id: newId() }));

      expect(create({ targets: many(100) }).snapshot.targets).toHaveLength(100);
      expect(() => create({ targets: many(101) })).toThrow(
        new InvalidValueError('A promotion has at most 100 targets'),
      );
      expect(() => create({ targets: [brand, shirt, { ...brand }] })).toThrow(
        new InvalidValueError('A promotion has each target once'),
      );
      // The same ID as another type is another target.
      expect(
        create({ targets: [brand, { type: 'CATEGORY', id: brand.id }] })
          .snapshot.targets,
      ).toHaveLength(2);
    });

    it('applies in some channel', () => {
      expect(() => create({ channels: [] })).toThrow(
        new InvalidValueError('A promotion applies in some channel'),
      );
    });

    it('ends after it starts', () => {
      expect(create({ endsAt: at(24.001) }).snapshot.endsAt).toEqual(
        at(24.001),
      );
      for (const endsAt of [at(24), at(23)]) {
        expect(() => create({ endsAt })).toThrow(PromotionEndError);
      }
      // A start already past is now, so the end must be after now.
      expect(() => create({ startsAt: at(-5), endsAt: NOW })).toThrow(
        PromotionEndError,
      );
    });

    it('names the end in its error', () => {
      expect(() => create({ endsAt: at(1) })).toThrow(
        expect.objectContaining({
          code: 'validation-error',
          details: {
            errors: [
              {
                field: 'endsAt',
                code: 'afterStart',
                message: 'Debe ser posterior al inicio.',
              },
            ],
          },
        }),
      );
    });
  });

  describe('its status', () => {
    const dates = { startsAt: at(1), endsAt: at(5), endedAt: null };

    it('is scheduled before its start, and active from it until its end', () => {
      expect(promotionStatus(dates, NOW)).toBe('SCHEDULED');
      expect(promotionStatus(dates, at(1))).toBe('ACTIVE');
      expect(promotionStatus(dates, at(4.999))).toBe('ACTIVE');
    });

    it('ends at its end, or once it was ended by hand, even before it started', () => {
      expect(promotionStatus(dates, at(5))).toBe('ENDED');
      expect(promotionStatus({ ...dates, endedAt: NOW }, NOW)).toBe('ENDED');
      expect(
        promotionStatus({ ...dates, endsAt: null, endedAt: at(-1) }, at(-2)),
      ).toBe('ENDED');
    });

    it('stays active without an end', () => {
      expect(promotionStatus({ ...dates, endsAt: null }, at(10_000))).toBe(
        'ACTIVE',
      );
    });
  });

  describe('editing it (UC-PRM-03)', () => {
    it('changes any term before it starts, and only what is sent', () => {
      const promotion = create();

      promotion.edit(
        {
          discount: { type: 'AMOUNT', amount: Money.of(20_000, 'MXN') },
          targets: [brand],
          channels: ['ONLINE'],
          minimumSubtotal: null,
          startsAt: at(48),
          endsAt: null,
          name: undefined,
        },
        NOW,
      );

      expect(promotion.snapshot).toMatchObject({
        name: 'Buen Fin 10%',
        discount: { type: 'AMOUNT', amount: Money.of(20_000, 'MXN') },
        targets: [brand],
        channels: ['ONLINE'],
        minimumSubtotal: null,
        startsAt: at(48),
        endsAt: null,
      });
      expect(promotion.targetsChanged).toBe(true);
    });

    it('starts a scheduled one now when given a start already past', () => {
      const promotion = create();

      promotion.edit({ startsAt: at(-3) }, NOW);

      expect(promotion.snapshot.startsAt).toEqual(NOW);
      expect(promotion.statusAt(NOW)).toBe('ACTIVE');
    });

    it('sees the same targets in another order as no change, keeping their order', () => {
      const promotion = create();

      promotion.edit({ targets: [shirts, shirt] }, NOW);

      expect(promotion.targetsChanged).toBe(false);
      expect(promotion.snapshot.targets).toEqual([shirt, shirts]);
    });

    it('changes only the name and the end once started', () => {
      const promotion = started();

      promotion.edit({ name: 'Buen Fin extendido', endsAt: at(120) }, NOW);
      promotion.edit({ endsAt: null }, NOW);

      expect(promotion.snapshot).toMatchObject({
        name: 'Buen Fin extendido',
        startsAt: at(-1),
        endsAt: null,
      });
    });

    it('takes the terms it already has once started, in any order', () => {
      const promotion = started();

      promotion.edit(
        {
          discount: { type: 'PERCENTAGE', percentage: 10 },
          targets: [shirts, shirt],
          channels: ['STORE', 'ONLINE'],
          minimumSubtotal: Money.of(50_000, 'MXN'),
          startsAt: at(-1),
        },
        NOW,
      );

      expect(promotion.snapshot.startsAt).toEqual(at(-1));
      expect(promotion.targetsChanged).toBe(false);
    });

    it.each([
      ['discount', { discount: { type: 'PERCENTAGE', percentage: 15 } }],
      [
        'discount',
        { discount: { type: 'AMOUNT', amount: Money.of(10, 'MXN') } },
      ],
      ['targets', { targets: [shirt] }],
      ['channels', { channels: ['ONLINE'] }],
      ['minimumSubtotal', { minimumSubtotal: null }],
      ['minimumSubtotal', { minimumSubtotal: Money.of(50_001, 'MXN') }],
      ['startsAt', { startsAt: NOW }],
    ] as const)('refuses to change its %s once started', (term, changes) => {
      const promotion = started();

      expect(() => promotion.edit(changes, NOW)).toThrow(
        new InvalidStateTransitionError('ACTIVE', `change its ${term}`),
      );
      expect(() => promotion.edit(changes, NOW)).toThrow(
        expect.objectContaining({ details: { currentStatus: 'ACTIVE' } }),
      );
    });

    it('ends a started one after now', () => {
      const promotion = started();

      expect(() => promotion.edit({ endsAt: NOW }, NOW)).toThrow(
        expect.objectContaining({
          details: {
            errors: [
              {
                field: 'endsAt',
                code: 'inFuture',
                message: 'Debe ser posterior al momento actual.',
              },
            ],
          },
        }),
      );
      promotion.edit({ endsAt: at(0.001) }, NOW);
      expect(promotion.snapshot.endsAt).toEqual(at(0.001));
    });

    it('refuses any change once it ended', () => {
      const promotion = create({ startsAt: at(-2), endsAt: at(-1) }, at(-3));

      expect(() => promotion.edit({ name: 'Otra' }, NOW)).toThrow(
        new InvalidStateTransitionError('ENDED', 'edit'),
      );
    });

    it('checks the terms again', () => {
      const promotion = create();

      expect(() => promotion.edit({ channels: [] }, NOW)).toThrow(
        new InvalidValueError('A promotion applies in some channel'),
      );
      expect(() => promotion.edit({ endsAt: at(1) }, NOW)).toThrow(
        PromotionEndError,
      );
    });
  });

  describe('ending it (UC-PRM-03)', () => {
    it('ends a scheduled one, which never starts', () => {
      const promotion = create();

      promotion.end(admin, NOW);

      expect(promotion.snapshot).toMatchObject({
        endedAt: NOW,
        endedBy: admin,
      });
      expect(promotion.statusAt(at(30))).toBe('ENDED');
    });

    it('ends an active one now', () => {
      const promotion = started();

      promotion.end(admin, NOW);

      expect(promotion.statusAt(NOW)).toBe('ENDED');
    });

    it('refuses to end it twice', () => {
      const promotion = started();
      promotion.end(admin, NOW);

      expect(() => promotion.end(admin, at(1))).toThrow(
        new InvalidStateTransitionError('ENDED', 'end'),
      );
    });

    it('restores what was saved', () => {
      const promotion = started();
      promotion.end(admin, NOW);

      expect(Promotion.restore(promotion.snapshot).snapshot).toEqual(
        promotion.snapshot,
      );
    });
  });
});
