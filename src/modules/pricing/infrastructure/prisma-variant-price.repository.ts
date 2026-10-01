import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { isExclusionViolation } from '../../../platform/persistence/prisma-errors.js';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import { Money, newId, toId } from '../../../shared-kernel/index.js';
import type { PriceListId } from '../domain/price-list.js';
import {
  PricePeriodConflictError,
  type VariantId,
  VariantPrice,
} from '../domain/variant-price.js';
import { VariantPriceRepository } from '../domain/variant-price.repository.js';

/** `variant_prices` and `price_periods` (DATABASE.md §5.2 and §5.3), always through the active transaction. */
@Injectable()
export class PrismaVariantPriceRepository extends VariantPriceRepository {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  async lock(
    priceListId: PriceListId,
    variantId: VariantId,
  ): Promise<VariantPrice> {
    const id =
      (await this.lockedRow(priceListId, variantId)) ??
      (await this.createRow(priceListId, variantId));
    const periods = await this.txHost.tx.pricePeriod.findMany({
      where: { variantPriceId: id },
    });
    return VariantPrice.of({
      id: toId<'VariantPrice'>(id),
      priceListId,
      variantId,
      periods: periods.map((row) => ({
        id: toId<'PricePeriod'>(row.id),
        amount: Money.of(row.amount, 'MXN'),
        compareAtAmount:
          row.compareAtAmount === null
            ? null
            : Money.of(row.compareAtAmount, 'MXN'),
        effectiveFrom: row.effectiveFrom,
        effectiveTo: row.effectiveTo,
        createdBy: row.createdBy,
        createdAt: row.createdAt,
      })),
    });
  }

  async save(prices: VariantPrice): Promise<void> {
    const { removed, ended, added } = prices.changes();
    if (removed.length + ended.length + added.length === 0) return;
    const tx = this.txHost.tx;
    try {
      if (removed.length > 0) {
        await tx.pricePeriod.deleteMany({
          where: { id: { in: [...removed] } },
        });
      }
      for (const period of ended) {
        await tx.pricePeriod.update({
          where: { id: period.id },
          data: { effectiveTo: period.effectiveTo },
        });
      }
      if (added.length > 0) {
        await tx.pricePeriod.createMany({
          data: added.map((period) => ({
            id: period.id,
            variantPriceId: prices.id,
            amount: period.amount.amount,
            compareAtAmount: period.compareAtAmount?.amount ?? null,
            effectiveFrom: period.effectiveFrom,
            effectiveTo: period.effectiveTo,
            createdBy: period.createdBy,
            createdAt: period.createdAt,
          })),
        });
      }
    } catch (error) {
      // The lock keeps changes of one variant apart, so only a change that skipped it gets here.
      if (isExclusionViolation(error)) {
        throw new PricePeriodConflictError('overlap');
      }
      throw error;
    }
    // The time comes from the application, as for every `@updatedAt` of Prisma (DEVELOPMENT_GUIDE.md).
    await tx.variantPrice.update({
      where: { id: prices.id },
      data: { version: { increment: 1 }, updatedAt: new Date() },
    });
    prices.markSaved();
  }

  private async lockedRow(
    priceListId: PriceListId,
    variantId: VariantId,
  ): Promise<string | undefined> {
    const rows = await this.txHost.tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM variant_prices
       WHERE price_list_id = ${priceListId}::uuid AND variant_id = ${variantId}::uuid
         FOR UPDATE`;
    return rows[0]?.id;
  }

  /**
   * The first price of the variant in the list. Two first prices at the same time both try to insert; the
   * second waits for the first one's commit, inserts nothing and then locks the row the first one created.
   */
  private async createRow(
    priceListId: PriceListId,
    variantId: VariantId,
  ): Promise<string> {
    const now = new Date();
    await this.txHost.tx.$executeRaw`
      INSERT INTO variant_prices (id, price_list_id, variant_id, created_at, updated_at)
      VALUES (${newId<'VariantPrice'>()}::uuid, ${priceListId}::uuid, ${variantId}::uuid, ${now}, ${now})
      ON CONFLICT (price_list_id, variant_id) DO NOTHING`;
    const id = await this.lockedRow(priceListId, variantId);
    if (id === undefined)
      throw new Error('The variant price row was not created');
    return id;
  }
}
