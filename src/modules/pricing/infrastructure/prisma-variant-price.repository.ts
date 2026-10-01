import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { isExclusionViolation } from '../../../platform/persistence/prisma-errors.js';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import { Money, newId, toId } from '../../../shared-kernel/index.js';
import type { PriceListId } from '../domain/price-list.js';
import {
  type PricePeriod,
  PricePeriodConflictError,
  type VariantId,
  VariantPrice,
} from '../domain/variant-price.js';
import { VariantPriceRepository } from '../domain/variant-price.repository.js';

/**
 * `variant_prices` and `price_periods` (DATABASE.md §5.2 and §5.3), always through the active transaction.
 * Every statement takes its rows as arrays, so a bulk import of thousands of rows runs the same few
 * statements as a single price (ADR-0126).
 */
@Injectable()
export class PrismaVariantPriceRepository extends VariantPriceRepository {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  async lock(
    priceListId: PriceListId,
    variantIds: readonly VariantId[],
  ): Promise<VariantPrice[]> {
    const ids = [...new Set(variantIds)].sort();
    if (ids.length === 0) return [];
    const tx = this.txHost.tx;
    const now = new Date();
    // A first price creates the row. Two first prices at the same time both try to insert it; the second
    // waits for the first one's commit and inserts nothing. In variant order, like the lock below.
    await tx.$executeRaw`
      INSERT INTO variant_prices (id, price_list_id, variant_id, created_at, updated_at)
      SELECT row.id, ${priceListId}::uuid, row.variant_id, ${now}, ${now}
        FROM unnest(${ids.map(() => newId<'VariantPrice'>())}::uuid[], ${ids}::uuid[])
             AS row(id, variant_id)
       ORDER BY row.variant_id
      ON CONFLICT (price_list_id, variant_id) DO NOTHING`;
    const rows = await tx.$queryRaw<{ id: string; variant_id: string }[]>`
      SELECT id, variant_id FROM variant_prices
       WHERE price_list_id = ${priceListId}::uuid AND variant_id = ANY(${ids}::uuid[])
       ORDER BY variant_id
         FOR UPDATE`;
    const periods = await tx.pricePeriod.findMany({
      where: { variantPriceId: { in: rows.map(({ id }) => id) } },
    });
    const byRow = new Map<string, typeof periods>();
    for (const period of periods) {
      const group = byRow.get(period.variantPriceId);
      if (group === undefined) byRow.set(period.variantPriceId, [period]);
      else group.push(period);
    }
    return rows.map((row) =>
      VariantPrice.of({
        id: toId<'VariantPrice'>(row.id),
        priceListId,
        variantId: toId<'Variant'>(row.variant_id),
        periods: (byRow.get(row.id) ?? []).map((period) => ({
          id: toId<'PricePeriod'>(period.id),
          amount: Money.of(period.amount, 'MXN'),
          compareAtAmount:
            period.compareAtAmount === null
              ? null
              : Money.of(period.compareAtAmount, 'MXN'),
          effectiveFrom: period.effectiveFrom,
          effectiveTo: period.effectiveTo,
          createdBy: period.createdBy,
          createdAt: period.createdAt,
        })),
      }),
    );
  }

  async save(prices: readonly VariantPrice[]): Promise<void> {
    const changed = prices
      .map((each) => ({ prices: each, changes: each.changes() }))
      .filter(
        ({ changes }) =>
          changes.removed.length + changes.ended.length + changes.added.length >
          0,
      );
    if (changed.length === 0) return;
    const removed = changed.flatMap(({ changes }) => changes.removed);
    const ended = changed.flatMap(({ changes }) => changes.ended);
    const added = changed.flatMap(({ prices: each, changes }) =>
      changes.added.map((period) => ({ variantPriceId: each.id, period })),
    );
    const tx = this.txHost.tx;
    try {
      if (removed.length > 0) {
        await tx.pricePeriod.deleteMany({
          where: { id: { in: [...removed] } },
        });
      }
      if (ended.length > 0) await this.end(ended);
      if (added.length > 0) {
        await tx.pricePeriod.createMany({
          data: added.map(({ variantPriceId, period }) => ({
            id: period.id,
            variantPriceId,
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
    await tx.variantPrice.updateMany({
      where: { id: { in: changed.map(({ prices: each }) => each.id) } },
      data: { version: { increment: 1 }, updatedAt: new Date() },
    });
    for (const { prices: each } of changed) each.markSaved();
  }

  /** The new ends of several periods in one statement. */
  private async end(periods: readonly PricePeriod[]): Promise<void> {
    await this.txHost.tx.$executeRaw`
      UPDATE price_periods
         SET effective_to = ended.effective_to
        FROM unnest(
               ${periods.map(({ id }) => id)}::uuid[],
               ${periods.map(({ effectiveTo }) => effectiveTo?.toISOString() ?? null)}::timestamptz[]
             ) AS ended(id, effective_to)
       WHERE price_periods.id = ended.id`;
  }
}
