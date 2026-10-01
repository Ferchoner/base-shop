import type { PriceListId } from './price-list.js';
import type { VariantId, VariantPrice } from './variant-price.js';

/**
 * `variant_prices` and `price_periods`, always through the active transaction. An abstract class rather than
 * an interface, so it can be the dependency injection token without depending on NestJS.
 */
export abstract class VariantPriceRepository {
  /**
   * The prices of the variants in the list, one per variant ordered by variant, with their rows locked until
   * the transaction ends, so changes to one variant run one after the other (ADR-0125). The rows are locked
   * in variant order, so two changes of several variants never wait for each other in a circle (ADR-0126).
   * A row is created on the first price of its variant, and a rolled back transaction takes it away again.
   */
  abstract lock(
    priceListId: PriceListId,
    variantIds: readonly VariantId[],
  ): Promise<VariantPrice[]>;

  /**
   * Writes the periods that changed, in a few statements whatever their number: first the deleted ones, then
   * the new ends, then the new periods, so the exclusion constraint never sees two periods overlap
   * (BR-PRC-01).
   *
   * @throws PricePeriodConflictError when the database rejects an overlap that the lock did not prevent.
   */
  abstract save(prices: readonly VariantPrice[]): Promise<void>;
}
