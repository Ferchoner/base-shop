import { Money, newId } from '../../../shared-kernel/index.js';
import {
  type NewPromotionTerms,
  Promotion,
  type PromotionChannel,
  type PromotionId,
  type UserId,
} from '../domain/promotion.js';
import type { PromotionRepository } from '../domain/promotion.repository.js';
import type {
  PromotionCatalog,
  VariantClassification,
} from './promotion-ports.js';
import { PromotionsFacade } from './promotions.facade.js';

const NOW = new Date('2026-10-17T18:00:00.000Z');
const mxn = (amount: number) => Money.of(amount, 'MXN');
const admin = newId<'User'>() as UserId;

const shirtVariant = newId();
const capVariant = newId();
const linen = newId();

const SHIRT: VariantClassification = {
  variantId: shirtVariant,
  productId: newId(),
  brandId: linen,
  categoryIds: [newId()],
};

const promotion = (terms: Partial<NewPromotionTerms> = {}) =>
  Promotion.create({
    id: newId<'Promotion'>() as PromotionId,
    terms: {
      name: 'Buen Fin',
      discount: { type: 'PERCENTAGE', percentage: 10 },
      targets: [],
      channels: ['ONLINE', 'STORE'],
      minimumSubtotal: null,
      startsAt: null,
      endsAt: null,
      ...terms,
    },
    createdBy: admin,
    at: new Date(NOW.getTime() - 3_600_000),
  });

function facade(active: Promotion[], classified = [SHIRT]) {
  const asked: { active: [Date, PromotionChannel][]; classify: string[][] } = {
    active: [],
    classify: [],
  };
  const promotions = {
    activeAt: (at: Date, channel: PromotionChannel) => {
      asked.active.push([at, channel]);
      return Promise.resolve(active);
    },
  } as unknown as PromotionRepository;
  const catalog = {
    classify: (ids: readonly string[]) => {
      asked.classify.push([...ids]);
      return Promise.resolve(classified);
    },
  } as unknown as PromotionCatalog;
  return { facade: new PromotionsFacade(promotions, catalog), asked };
}

const LINES = [
  { variantId: shirtVariant, lineTotal: mxn(60_000) },
  { variantId: capVariant, lineTotal: mxn(20_000) },
];

describe('PromotionsFacade (T-200 part b, ADR-0168)', () => {
  it('gives the promotion of the lines, with what it takes off each one', async () => {
    const byBrand = promotion({
      name: 'Lino 20%',
      discount: { type: 'PERCENTAGE', percentage: 20 },
      targets: [{ type: 'BRAND', id: linen }],
    });
    const { facade: promotions, asked } = facade([promotion(), byBrand]);

    expect(
      await promotions.discountFor({
        channel: 'STORE',
        at: NOW,
        lines: LINES,
      }),
    ).toEqual({
      promotion: { id: byBrand.id, name: 'Lino 20%' },
      discounts: [mxn(12_000), mxn(0)],
    });
    expect(asked).toEqual({
      active: [[NOW, 'STORE']],
      classify: [[shirtVariant, capVariant]],
    });
  });

  it('gives a variant Catalog no longer has only a promotion of the whole purchase', async () => {
    const byProduct = promotion({
      discount: { type: 'PERCENTAGE', percentage: 50 },
      targets: [{ type: 'PRODUCT', id: SHIRT.productId }],
    });
    const whole = promotion();

    expect(
      await facade([byProduct, whole], []).facade.discountFor({
        channel: 'ONLINE',
        at: NOW,
        lines: LINES,
      }),
    ).toEqual({
      promotion: { id: whole.id, name: 'Buen Fin' },
      discounts: [mxn(6_000), mxn(2_000)],
    });
  });

  it('answers null when no promotion takes anything off', async () => {
    const elsewhere = promotion({
      targets: [{ type: 'PRODUCT', id: newId() }],
    });

    expect(
      await facade([elsewhere]).facade.discountFor({
        channel: 'ONLINE',
        at: NOW,
        lines: LINES,
      }),
    ).toBeNull();
  });

  it('asks nothing for no lines, and does not classify without active promotions', async () => {
    const empty = facade([promotion()]);
    const none = facade([]);

    expect(
      await empty.facade.discountFor({ channel: 'ONLINE', at: NOW, lines: [] }),
    ).toBeNull();
    expect(
      await none.facade.discountFor({
        channel: 'ONLINE',
        at: NOW,
        lines: LINES,
      }),
    ).toBeNull();
    expect(empty.asked).toEqual({ active: [], classify: [] });
    expect(none.asked).toEqual({ active: [[NOW, 'ONLINE']], classify: [] });
  });
});
