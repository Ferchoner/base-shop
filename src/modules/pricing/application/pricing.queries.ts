import type { Currency, Money } from '../../../shared-kernel/index.js';
import type { PriceListId } from '../domain/price-list.js';
import type {
  PricePeriodId,
  PricePeriodState,
  VariantId,
} from '../domain/variant-price.js';

export type { PricePeriodState } from '../domain/variant-price.js';
export { PRICE_PERIOD_STATES } from '../domain/variant-price.js';

/** `PriceList` of API_SPEC.md §12. */
export interface PriceListView {
  readonly id: PriceListId;
  readonly code: string;
  readonly name: string;
  readonly currency: Currency;
  readonly priority: number;
  readonly isDefault: boolean;
  readonly taxesIncluded: boolean;
  readonly status: 'ACTIVE' | 'INACTIVE';
}

/** A stored price period (DATABASE.md §5.3). */
export interface PricePeriodView {
  readonly id: PricePeriodId;
  readonly amount: Money;
  readonly compareAtAmount: Money | null;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
  readonly createdBy: string;
  readonly createdAt: Date;
}

/** `PricePeriod` of API_SPEC.md §12: a period and whether it ended, is in force or has not begun. */
export interface PricePeriodStateView extends PricePeriodView {
  readonly state: PricePeriodState;
}

/** The price of a variant in force at an instant (UC-PRC-06). */
export interface PriceQuote {
  readonly variantId: VariantId;
  /** VAT included (ADR-0008, ADR-0039). */
  readonly amount: Money;
  readonly compareAtAmount: Money | null;
}

/**
 * Read models of Pricing. An abstract class rather than an interface, so it can be the dependency injection
 * token without depending on NestJS.
 */
export abstract class PricingQueries {
  /** Every list, the default one first. */
  abstract listPriceLists(): Promise<PriceListView[]>;

  /** The periods of the variant in the list, the latest start first. */
  abstract listPeriods(
    priceListId: PriceListId,
    variantId: VariantId,
  ): Promise<PricePeriodView[]>;

  /** The price in force at `at` of each variant that has one in the list, in one query. */
  abstract currentPrices(
    priceListId: PriceListId,
    variantIds: readonly VariantId[],
    at: Date,
  ): Promise<PriceQuote[]>;
}
