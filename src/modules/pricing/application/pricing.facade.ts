import { Injectable } from '@nestjs/common';
import { PriceListRepository } from '../domain/price-list.repository.js';
import type { VariantId } from '../domain/variant-price.js';
import { type PriceQuote, PricingQueries } from './pricing.queries.js';

export type { PriceQuote } from './pricing.queries.js';

/**
 * Public API of Pricing (ADR-0005, UC-PRC-06) for the store (T-140 part c), the cart (T-170) and the
 * checkout (T-180). It reads the database on every call, never from a cache, and needs no job for scheduled
 * prices: the price in force is the one whose period contains the instant asked.
 */
@Injectable()
export class PricingFacade {
  constructor(
    private readonly lists: PriceListRepository,
    private readonly queries: PricingQueries,
  ) {}

  /**
   * The prices in force at `at` in the default list, by variant. A variant without a price then is left
   * out: it cannot be sold (BR-PRD-11). With more lists, a more specific one would come first and the
   * default one would fill in (BR-PRC-07, BR-PRC-10); the MVP has only the default one (ADR-0039).
   */
  async quote(
    variantIds: readonly VariantId[],
    at: Date,
  ): Promise<ReadonlyMap<VariantId, PriceQuote>> {
    const unique = [...new Set(variantIds)];
    if (unique.length === 0) return new Map();
    const list = await this.lists.findDefault();
    // A migration creates it (ADR-0125), and nothing deactivates it (BR-PRC-06).
    if (list === null) throw new Error('There is no default price list');
    const quotes = await this.queries.currentPrices(list, unique, at);
    return new Map(quotes.map((quote) => [quote.variantId, quote]));
  }
}
