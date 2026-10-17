import type {
  Money,
  Page,
  PageRequest,
  SortOrder,
} from '../../../shared-kernel/index.js';
import type {
  Discount,
  PromotionChannel,
  PromotionId,
  PromotionStatus,
  PromotionTarget,
  UserId,
} from '../domain/promotion.js';

/** A promotion in a list, without its targets. */
export interface PromotionSummaryView {
  readonly id: PromotionId;
  readonly name: string;
  readonly discount: Discount;
  /** How many products, categories and brands it targets; 0 for the whole purchase. */
  readonly targetCount: number;
  readonly channels: readonly PromotionChannel[];
  readonly minimumSubtotal: Money | null;
  readonly startsAt: Date;
  readonly endsAt: Date | null;
  /** When it was ended by hand. */
  readonly endedAt: Date | null;
}

/** A promotion as the staff sees it (UC-PRM-02), with its targets. */
export interface PromotionView extends Omit<
  PromotionSummaryView,
  'targetCount'
> {
  /** Products first, then categories, then brands, each by ID. */
  readonly targets: readonly PromotionTarget[];
  readonly endedBy: UserId | null;
  readonly createdBy: UserId;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly version: number;
}

/** Whether a promotion applies to the whole purchase, or to some products, categories or brands. */
export type PromotionReach = 'ORDER' | 'ITEMS';

export const PROMOTION_REACHES: readonly PromotionReach[] = ['ORDER', 'ITEMS'];

export interface PromotionFilter {
  /** Part of the name, whatever its case. */
  readonly q?: string;
  /** Any of these, at the moment of the read. */
  readonly status?: readonly PromotionStatus[];
  /** The ones that apply in this channel. */
  readonly channel?: PromotionChannel;
  readonly appliesTo?: PromotionReach;
}

export type PromotionSortField = 'startsAt' | 'name';

/**
 * Read models of Promotions, straight from its tables. An abstract class rather than an interface, so it can be the
 * dependency injection token without depending on NestJS.
 */
export abstract class PromotionQueries {
  abstract findPromotion(id: PromotionId): Promise<PromotionView | null>;

  /** `at` is the moment the status filter compares the dates with. */
  abstract listPromotions(
    filter: PromotionFilter,
    sort: readonly SortOrder<PromotionSortField>[],
    page: PageRequest,
    at: Date,
  ): Promise<Page<PromotionSummaryView>>;
}
