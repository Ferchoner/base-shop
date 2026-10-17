import { Injectable } from '@nestjs/common';
import type { Money } from '../../../shared-kernel/index.js';
import type { PromotionChannel } from '../domain/promotion.js';
import { bestDiscount } from '../domain/promotion-discounts.js';
import { PromotionRepository } from '../domain/promotion.repository.js';
import { PromotionCatalog } from './promotion-ports.js';

/** A line of an order that can be sold, as Ordering prices it. */
export interface PromotionLine {
  readonly variantId: string;
  /** Its price by its quantity, VAT included (ADR-0008). */
  readonly lineTotal: Money;
}

/** The promotion an order gets, and what it takes off each line, in the order of the lines given (ADR-0168). */
export interface AppliedDiscount {
  readonly promotion: { readonly id: string; readonly name: string };
  readonly discounts: readonly Money[];
}

/**
 * Public API of Promotions for the other contexts (ADR-0005). Ordering asks it for the discount of every quote and
 * every order it places (T-200 part b), and applies it.
 */
@Injectable()
export class PromotionsFacade {
  constructor(
    private readonly promotions: PromotionRepository,
    private readonly catalog: PromotionCatalog,
  ) {}

  /**
   * The promotion these lines get at `at` in this channel, and what it takes off each one (ADR-0168): the one that
   * takes off the most, with the products still paying at least one peso. A variant Catalog no longer has only gets a
   * promotion of the whole purchase. `null` when none takes anything off.
   */
  async discountFor(input: {
    readonly channel: PromotionChannel;
    readonly at: Date;
    readonly lines: readonly PromotionLine[];
  }): Promise<AppliedDiscount | null> {
    if (input.lines.length === 0) return null;
    const promotions = await this.promotions.activeAt(input.at, input.channel);
    if (promotions.length === 0) return null;
    const classified = new Map(
      (
        await this.catalog.classify(
          input.lines.map(({ variantId }) => variantId),
        )
      ).map((variant) => [variant.variantId, variant]),
    );
    const best = bestDiscount(
      promotions,
      input.lines.map(({ variantId, lineTotal }) => {
        const variant = classified.get(variantId);
        return {
          lineTotal,
          productId: variant?.productId ?? '',
          brandId: variant?.brandId ?? null,
          categoryIds: variant?.categoryIds ?? [],
        };
      }),
      input.channel,
      input.at,
    );
    return best === null
      ? null
      : {
          promotion: {
            id: best.promotion.id,
            name: best.promotion.snapshot.name,
          },
          discounts: best.discounts,
        };
  }
}
