import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import { type Currency, Money, toId } from '../../../shared-kernel/index.js';
import {
  type PriceListView,
  type PricePeriodView,
  PricingQueries,
  type PriceQuote,
} from '../application/pricing.queries.js';
import type { PriceListId } from '../domain/price-list.js';
import type { VariantId } from '../domain/variant-price.js';

const mxn = (cents: number | null) =>
  cents === null ? null : Money.of(cents, 'MXN');

/** Read models of Pricing, straight from its tables (DATABASE.md §5). */
@Injectable()
export class PrismaPricingQueries extends PricingQueries {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  async listPriceLists(): Promise<PriceListView[]> {
    const rows = await this.txHost.tx.priceList.findMany({
      orderBy: [{ isDefault: 'desc' }, { priority: 'asc' }, { code: 'asc' }],
    });
    return rows.map((row) => ({
      id: toId<'PriceList'>(row.id),
      code: row.code,
      name: row.name,
      currency: row.currency as Currency,
      priority: row.priority,
      isDefault: row.isDefault,
      taxesIncluded: row.taxesIncluded,
      status: row.status,
    }));
  }

  async listPeriods(
    priceListId: PriceListId,
    variantId: VariantId,
  ): Promise<PricePeriodView[]> {
    const rows = await this.txHost.tx.pricePeriod.findMany({
      where: { variantPrice: { priceListId, variantId } },
      orderBy: { effectiveFrom: 'desc' },
    });
    return rows.map((row) => ({
      id: toId<'PricePeriod'>(row.id),
      amount: Money.of(row.amount, 'MXN'),
      compareAtAmount: mxn(row.compareAtAmount),
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
    }));
  }

  async currentPrices(
    priceListId: PriceListId,
    variantIds: readonly VariantId[],
    at: Date,
  ): Promise<PriceQuote[]> {
    const rows = await this.txHost.tx.pricePeriod.findMany({
      where: {
        variantPrice: { priceListId, variantId: { in: [...variantIds] } },
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
      },
      select: {
        amount: true,
        compareAtAmount: true,
        variantPrice: { select: { variantId: true } },
      },
    });
    return rows.map((row) => ({
      variantId: toId<'Variant'>(row.variantPrice.variantId),
      amount: Money.of(row.amount, 'MXN'),
      compareAtAmount: mxn(row.compareAtAmount),
    }));
  }
}
