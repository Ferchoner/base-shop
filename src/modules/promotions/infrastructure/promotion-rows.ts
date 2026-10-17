import { Money } from '../../../shared-kernel/index.js';
import type {
  Discount,
  PromotionChannel,
  PromotionTarget,
  PromotionTerms,
} from '../domain/promotion.js';

/** The columns of a promotion that hold its terms. */
interface TermColumns {
  readonly name: string;
  readonly percentage: number | null;
  readonly amountOff: number | null;
  readonly online: boolean;
  readonly inStore: boolean;
  readonly minimumSubtotal: number | null;
  readonly startsAt: Date;
  readonly endsAt: Date | null;
}

/** The targets of a promotion as they are read: products, then categories, then brands, each by ID. */
export const TARGETS_IN_ORDER = {
  targets: {
    orderBy: [{ targetType: 'asc' as const }, { targetId: 'asc' as const }],
  },
};

export function termsOf(terms: PromotionTerms): TermColumns {
  return {
    name: terms.name,
    percentage:
      terms.discount.type === 'PERCENTAGE' ? terms.discount.percentage : null,
    amountOff:
      terms.discount.type === 'AMOUNT' ? terms.discount.amount.amount : null,
    online: terms.channels.includes('ONLINE'),
    inStore: terms.channels.includes('STORE'),
    minimumSubtotal: terms.minimumSubtotal?.amount ?? null,
    startsAt: terms.startsAt,
    endsAt: terms.endsAt,
  };
}

export function targetsOf(targets: readonly PromotionTarget[]) {
  return targets.map(({ type, id }) => ({ targetType: type, targetId: id }));
}

export function discountOf(row: {
  readonly percentage: number | null;
  readonly amountOff: number | null;
}): Discount {
  // The database keeps exactly one of them (`promotions_discount_check`).
  return row.percentage !== null
    ? { type: 'PERCENTAGE', percentage: row.percentage }
    : { type: 'AMOUNT', amount: Money.of(row.amountOff!, 'MXN') };
}

export function channelsOf(row: {
  readonly online: boolean;
  readonly inStore: boolean;
}): PromotionChannel[] {
  return [
    ...(row.online ? (['ONLINE'] as const) : []),
    ...(row.inStore ? (['STORE'] as const) : []),
  ];
}

export function toTerms(
  row: TermColumns & {
    readonly targets: readonly {
      readonly targetType: PromotionTarget['type'];
      readonly targetId: string;
    }[];
  },
): PromotionTerms {
  return {
    name: row.name,
    discount: discountOf(row),
    targets: row.targets.map(({ targetType, targetId }) => ({
      type: targetType,
      id: targetId,
    })),
    channels: channelsOf(row),
    minimumSubtotal:
      row.minimumSubtotal === null
        ? null
        : Money.of(row.minimumSubtotal, 'MXN'),
    startsAt: row.startsAt,
    endsAt: row.endsAt,
  };
}
