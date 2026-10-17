import { Money } from '../../../shared-kernel/index.js';
import type {
  Promotion,
  PromotionChannel,
  PromotionTerms,
} from './promotion.js';

/** A line of an order as a promotion sees it (ADR-0168): what it costs and what it is. */
export interface DiscountableLine {
  /** VAT included (ADR-0008). */
  readonly lineTotal: Money;
  readonly productId: string;
  readonly brandId: string | null;
  /** The categories of its product and every one above them. */
  readonly categoryIds: readonly string[];
}

/** The promotion an order gets and what it takes off each of its lines, in their order. */
export interface PromotionDiscount {
  readonly promotion: Promotion;
  readonly discounts: readonly Money[];
}

/** The least the products of an order pay when a promotion applies, in cents: one peso (ADR-0168). */
export const MINIMUM_PAYMENT = 100;

const ZERO = Money.zero('MXN');

/**
 * Whether a promotion applies to a line (ADR-0168): any line for one of the whole purchase; else, a line whose product
 * it names, whose brand it names, or whose product is in a category it names or below one, whatever their status.
 */
export function appliesTo(
  terms: PromotionTerms,
  line: DiscountableLine,
): boolean {
  if (terms.targets.length === 0) return true;
  return terms.targets.some(({ type, id }) => {
    switch (type) {
      case 'PRODUCT':
        return line.productId === id;
      case 'BRAND':
        return line.brandId === id;
      case 'CATEGORY':
        return line.categoryIds.includes(id);
    }
  });
}

/**
 * What a promotion takes off each line, before the least the order pays (ADR-0168):
 * - a percentage, by line, rounded half up like the VAT (ADR-0094);
 * - an amount, at most what its lines add up to, split in proportion to their totals; the cents left by rounding
 *   down go one by one to the lines of highest total, the first of them on a tie.
 */
export function discountsOf(
  terms: PromotionTerms,
  lines: readonly DiscountableLine[],
): Money[] {
  const eligible = lines.map((line) => appliesTo(terms, line));
  const { discount } = terms;
  if (discount.type === 'PERCENTAGE') {
    return lines.map((line, index) =>
      eligible[index]
        ? Money.of(
            Math.floor(
              (line.lineTotal.amount * discount.percentage + 50) / 100,
            ),
            'MXN',
          )
        : ZERO,
    );
  }
  const total = lines.reduce(
    (sum, line, index) => sum + (eligible[index] ? line.lineTotal.amount : 0),
    0,
  );
  if (total === 0) return lines.map(() => ZERO);
  const amount = BigInt(Math.min(discount.amount.amount, total));
  const shares = lines.map((line, index) =>
    eligible[index]
      ? Number((amount * BigInt(line.lineTotal.amount)) / BigInt(total))
      : 0,
  );
  let left = Number(amount) - shares.reduce((sum, share) => sum + share, 0);
  const byTotal = lines
    .map((line, index) => ({ index, total: line.lineTotal.amount }))
    .filter(({ index }) => eligible[index])
    .sort((a, b) => b.total - a.total || a.index - b.index);
  for (let next = 0; left > 0; next = (next + 1) % byTotal.length) {
    shares[byTotal[next].index] += 1;
    left -= 1;
  }
  return shares.map((share) => Money.of(share, 'MXN'));
}

/**
 * The discounts reduced so the products still pay at least one peso (ADR-0168): what is taken back comes off the
 * lines with the highest discount first, the first of them on a tie.
 */
export function withMinimumPayment(
  discounts: readonly Money[],
  lines: readonly DiscountableLine[],
): Money[] {
  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal.amount, 0);
  const taken = discounts.reduce((sum, discount) => sum + discount.amount, 0);
  let excess = Math.min(taken, MINIMUM_PAYMENT - (subtotal - taken));
  const reduced = discounts.map(({ amount }) => amount);
  const byDiscount = reduced
    .map((amount, index) => ({ amount, index }))
    .sort((a, b) => b.amount - a.amount || a.index - b.index);
  for (const { index } of byDiscount) {
    if (excess <= 0) break;
    const back = Math.min(excess, reduced[index]);
    reduced[index] -= back;
    excess -= back;
  }
  return reduced.map((amount) => Money.of(amount, 'MXN'));
}

/**
 * The automatic promotion an order gets (ADR-0168): among the ones active at `at` in its channel whose minimum
 * purchase the subtotal reaches, before any discount, the one that takes off the most once the products pay at least
 * one peso; on a tie, the one that started first, then the first by ID. A coupon never applies by itself. `null` when
 * none takes anything off.
 */
export function bestDiscount(
  promotions: readonly Promotion[],
  lines: readonly DiscountableLine[],
  channel: PromotionChannel,
  at: Date,
): PromotionDiscount | null {
  const subtotal = lines.reduce((sum, line) => sum.add(line.lineTotal), ZERO);
  let best: { discount: PromotionDiscount; taken: number } | null = null;
  for (const promotion of promotions) {
    const terms = promotion.snapshot;
    if (
      promotion.isCoupon ||
      promotion.statusAt(at) !== 'ACTIVE' ||
      !terms.channels.includes(channel) ||
      (terms.minimumSubtotal !== null &&
        subtotal.lessThan(terms.minimumSubtotal))
    ) {
      continue;
    }
    const discounts = withMinimumPayment(discountsOf(terms, lines), lines);
    const taken = discounts.reduce((sum, discount) => sum + discount.amount, 0);
    if (taken === 0 || (best !== null && !beats(terms, taken, best))) {
      continue;
    }
    best = { discount: { promotion, discounts }, taken };
  }
  return best?.discount ?? null;
}

function beats(
  terms: Promotion['snapshot'],
  taken: number,
  best: { discount: PromotionDiscount; taken: number },
): boolean {
  if (taken !== best.taken) return taken > best.taken;
  const other = best.discount.promotion.snapshot;
  const started = terms.startsAt.getTime() - other.startsAt.getTime();
  return started !== 0 ? started < 0 : terms.id < other.id;
}

/**
 * Why a coupon does not apply (ADR-0168): it is not active in the channel of the order, which answers as an unknown
 * code does (`unavailable`); it has no uses left (`exhausted`); the subtotal does not reach its minimum
 * (`minimumNotMet`); or it takes nothing off the lines (`noEligibleLines`).
 */
export type CouponRefusal =
  'unavailable' | 'exhausted' | 'minimumNotMet' | 'noEligibleLines';

/**
 * What a coupon takes off these lines at `at` in this channel, with the products still paying at least one peso, or
 * why it does not apply (ADR-0168). The uses by each customer are counted where the orders are.
 */
export function couponDiscount(
  coupon: Promotion,
  lines: readonly DiscountableLine[],
  channel: PromotionChannel,
  at: Date,
):
  | { readonly discounts: readonly Money[] }
  | { readonly refused: CouponRefusal } {
  const terms = coupon.snapshot;
  if (coupon.statusAt(at) !== 'ACTIVE' || !terms.channels.includes(channel)) {
    return { refused: 'unavailable' };
  }
  if (terms.usageLimit !== null && terms.uses >= terms.usageLimit) {
    return { refused: 'exhausted' };
  }
  const subtotal = lines.reduce((sum, line) => sum.add(line.lineTotal), ZERO);
  if (
    terms.minimumSubtotal !== null &&
    subtotal.lessThan(terms.minimumSubtotal)
  ) {
    return { refused: 'minimumNotMet' };
  }
  const discounts = withMinimumPayment(discountsOf(terms, lines), lines);
  return discounts.every((discount) => discount.isZero())
    ? { refused: 'noEligibleLines' }
    : { discounts };
}
