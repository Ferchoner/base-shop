import { Injectable } from '@nestjs/common';
import { type Money, toId } from '../../../shared-kernel/index.js';
import {
  normalizedCouponCode,
  type Promotion,
  type PromotionChannel,
} from '../domain/promotion.js';
import {
  bestDiscount,
  couponDiscount,
  type CouponRefusal,
  type DiscountableLine,
} from '../domain/promotion-discounts.js';
import { PromotionRepository } from '../domain/promotion.repository.js';
import { PromotionCatalog } from './promotion-ports.js';

export type { CouponRefusal } from '../domain/promotion-discounts.js';

/** A line of an order that can be sold, as Ordering prices it. */
export interface PromotionLine {
  readonly variantId: string;
  /** Its price by its quantity, VAT included (ADR-0008). */
  readonly lineTotal: Money;
}

/** The promotion an order gets, and what it takes off each line, in the order of the lines given (ADR-0168). */
export interface AppliedDiscount {
  readonly promotion: {
    readonly id: string;
    readonly name: string;
    /** The code of a coupon; `null` for an automatic promotion. */
    readonly code: string | null;
    /** Whether each customer uses the coupon once: Ordering counts it in their orders. */
    readonly oncePerCustomer: boolean;
  };
  readonly discounts: readonly Money[];
}

/** A coupon that applies, or why it does not (ADR-0168). */
export type CouponResult =
  { readonly applied: AppliedDiscount } | { readonly refused: CouponRefusal };

/**
 * Public API of Promotions for the other contexts (ADR-0005). Ordering asks it for the discount of every quote and
 * every order it places (T-200 part b), and counts and gives back the uses of the coupons of its orders, in its own
 * transactions (T-200 part c).
 */
@Injectable()
export class PromotionsFacade {
  constructor(
    private readonly promotions: PromotionRepository,
    private readonly catalog: PromotionCatalog,
  ) {}

  /**
   * The automatic promotion these lines get at `at` in this channel, and what it takes off each one (ADR-0168): the
   * one that takes off the most, with the products still paying at least one peso. A variant Catalog no longer has
   * only gets a promotion of the whole purchase. `null` when none takes anything off.
   */
  async discountFor(input: {
    readonly channel: PromotionChannel;
    readonly at: Date;
    readonly lines: readonly PromotionLine[];
  }): Promise<AppliedDiscount | null> {
    if (input.lines.length === 0) return null;
    const promotions = await this.promotions.activeAt(input.at, input.channel);
    if (promotions.length === 0) return null;
    const best = bestDiscount(
      promotions,
      await this.classified(input.lines),
      input.channel,
      input.at,
    );
    return best === null ? null : applied(best.promotion, best.discounts);
  }

  /**
   * What the coupon with this code, whatever its case, takes off these lines at `at` in this channel, or why it does
   * not apply (ADR-0168). A code no promotion has answers `unavailable`, as one that is not active in the channel.
   */
  async couponFor(input: {
    readonly channel: PromotionChannel;
    readonly at: Date;
    readonly lines: readonly PromotionLine[];
    readonly code: string;
  }): Promise<CouponResult> {
    const coupon = await this.promotions.findByCode(
      normalizedCouponCode(input.code),
    );
    if (coupon === null) return { refused: 'unavailable' };
    const result = couponDiscount(
      coupon,
      await this.classified(input.lines),
      input.channel,
      input.at,
    );
    return 'refused' in result
      ? result
      : { applied: applied(coupon, result.discounts) };
  }

  /**
   * Counts a use of a coupon, in the transaction of the caller, which places an order with it (ADR-0168): its row stays
   * locked until the transaction ends, so two orders never take its last use.
   *
   * @returns false when it has no uses left.
   */
  redeem(promotionId: string): Promise<boolean> {
    return this.promotions.addUse(toId<'Promotion'>(promotionId), {
      beyondLimit: false,
    });
  }

  /** Counts again the use of an order a late payment reopens, even past the limit: the customer already paid. */
  async recount(promotionId: string): Promise<void> {
    await this.promotions.addUse(toId<'Promotion'>(promotionId), {
      beyondLimit: true,
    });
  }

  /** Gives back the use of an order that expired or was cancelled. */
  release(promotionId: string): Promise<void> {
    return this.promotions.removeUse(toId<'Promotion'>(promotionId));
  }

  /** The lines with what Catalog says of their variants; a variant it no longer has only fits the whole purchase. */
  private async classified(
    lines: readonly PromotionLine[],
  ): Promise<DiscountableLine[]> {
    const classified = new Map(
      lines.length === 0
        ? []
        : (
            await this.catalog.classify(lines.map(({ variantId }) => variantId))
          ).map((variant) => [variant.variantId, variant]),
    );
    return lines.map(({ variantId, lineTotal }) => {
      const variant = classified.get(variantId);
      return {
        lineTotal,
        productId: variant?.productId ?? '',
        brandId: variant?.brandId ?? null,
        categoryIds: variant?.categoryIds ?? [],
      };
    });
  }
}

function applied(
  promotion: Promotion,
  discounts: readonly Money[],
): AppliedDiscount {
  const { name, code, oncePerCustomer } = promotion.snapshot;
  return {
    promotion: { id: promotion.id, name, code, oncePerCustomer },
    discounts,
  };
}
