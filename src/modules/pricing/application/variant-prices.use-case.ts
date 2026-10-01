import { Injectable } from '@nestjs/common';
import {
  AuditTrail,
  changesBetween,
  Clock,
  Money,
  newId,
  NotFoundError,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import type { PriceListId } from '../domain/price-list.js';
import { PriceListRepository } from '../domain/price-list.repository.js';
import {
  type PricePeriod,
  type PricePeriodId,
  type PricePeriodState,
  periodState,
  type VariantId,
  type VariantPrice,
} from '../domain/variant-price.js';
import { VariantPriceRepository } from '../domain/variant-price.repository.js';
import { CatalogVariants } from './catalog-variants.js';
import {
  type PricePeriodStateView,
  type PricePeriodView,
  PricingQueries,
} from './pricing.queries.js';

/** What the audit trail keeps of a period: where it belongs and its values, amounts in cents. */
function auditedFields(
  prices: VariantPrice,
  period: PricePeriod,
): Record<string, unknown> {
  return {
    priceListId: prices.priceListId,
    variantId: prices.variantId,
    amount: period.amount.amount,
    compareAtAmount: period.compareAtAmount?.amount ?? null,
    effectiveFrom: period.effectiveFrom,
  };
}

function withState(period: PricePeriodView, at: Date): PricePeriodStateView {
  return { ...period, state: periodState(period, at) };
}

/**
 * The prices of a variant in a list (UC-PRC-01 to 04, ADR-0039, ADR-0125). Each change locks the variant's
 * row of the list, so two changes of one variant run one after the other, each with its own "now".
 */
@Injectable()
export class VariantPrices {
  constructor(
    private readonly lists: PriceListRepository,
    private readonly prices: VariantPriceRepository,
    private readonly queries: PricingQueries,
    private readonly variants: CatalogVariants,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  /** Every period, the latest start first, or only those in `states`; and the one in force (UC-PRC-01). */
  async history(
    priceListId: PriceListId,
    variantId: VariantId,
    states?: readonly PricePeriodState[],
  ): Promise<{
    periods: PricePeriodStateView[];
    current: PricePeriodStateView | null;
  }> {
    await this.requireListAndVariant(priceListId, variantId);
    const now = this.clock.now();
    const periods = (
      await this.queries.listPeriods(priceListId, variantId)
    ).map((period) => withState(period, now));
    return {
      periods:
        states === undefined
          ? periods
          : periods.filter(({ state }) => states.includes(state)),
      current: periods.find(({ state }) => state === 'CURRENT') ?? null,
    };
  }

  /**
   * Sets a price from now on (UC-PRC-02) or schedules it (UC-PRC-03), by `staffId`. `created` is false when
   * the price from now on equals the current one: then nothing is saved or audited, and the current period
   * is answered.
   */
  async set(
    priceListId: PriceListId,
    variantId: VariantId,
    input: {
      /** Cents, VAT included. */
      amount: number;
      compareAtAmount: number | null;
      /** `null`, or not after now: from now on. */
      effectiveFrom: Date | null;
    },
    staffId: string,
  ): Promise<{ period: PricePeriodStateView; created: boolean }> {
    const amount = Money.of(input.amount, 'MXN');
    const compareAtAmount =
      input.compareAtAmount === null
        ? null
        : Money.of(input.compareAtAmount, 'MXN');
    await this.requireListAndVariant(priceListId, variantId);
    return this.transactions.run(async () => {
      const prices = await this.prices.lock(priceListId, variantId);
      // Read after the lock, so a change that waited for another one starts after it.
      const now = this.clock.now();
      const { period, change } = prices.set(
        {
          id: newId<'PricePeriod'>(),
          amount,
          compareAtAmount,
          effectiveFrom: input.effectiveFrom,
          createdBy: staffId,
        },
        now,
      );
      if (change !== 'unchanged') {
        await this.prices.save(prices);
        await this.audit.record({
          action: change === 'set' ? 'prices.set' : 'prices.schedule',
          resource: { type: 'price-period', id: period.id },
          changes: changesBetween({}, auditedFields(prices, period)),
        });
      }
      return {
        period: withState(period, now),
        created: change !== 'unchanged',
      };
    });
  }

  /** Cancels a scheduled price (UC-PRC-04); the period before it lasts until the next one again. */
  async cancel(
    priceListId: PriceListId,
    variantId: VariantId,
    periodId: PricePeriodId,
  ): Promise<void> {
    await this.requireListAndVariant(priceListId, variantId);
    await this.transactions.run(async () => {
      const prices = await this.prices.lock(priceListId, variantId);
      const period = prices.cancel(periodId, this.clock.now());
      await this.prices.save(prices);
      await this.audit.record({
        action: 'prices.cancel',
        resource: { type: 'price-period', id: periodId },
        changes: changesBetween(auditedFields(prices, period), {}),
      });
    });
  }

  private async requireListAndVariant(
    priceListId: PriceListId,
    variantId: VariantId,
  ): Promise<void> {
    if (!(await this.lists.exists(priceListId))) {
      throw new NotFoundError('PriceList', priceListId);
    }
    if (!(await this.variants.exists(variantId))) {
      throw new NotFoundError('Variant', variantId);
    }
  }
}
