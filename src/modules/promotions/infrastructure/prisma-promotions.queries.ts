import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { Prisma } from '../../../platform/persistence/prisma/generated/client.js';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import {
  Money,
  type Page,
  pageOffset,
  type PageRequest,
  type SortOrder,
  toId,
} from '../../../shared-kernel/index.js';
import {
  normalizedCouponCode,
  type PromotionId,
  type PromotionStatus,
} from '../domain/promotion.js';
import {
  type PromotionFilter,
  PromotionQueries,
  type PromotionSortField,
  type PromotionSummaryView,
  type PromotionView,
} from '../application/promotions.queries.js';
import {
  channelsOf,
  discountOf,
  TARGETS_IN_ORDER,
  toTerms,
} from './promotion-rows.js';

/** Read models of Promotions in PostgreSQL (DATABASE.md §18). */
@Injectable()
export class PrismaPromotionQueries extends PromotionQueries {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  async findPromotion(id: PromotionId): Promise<PromotionView | null> {
    const row = await this.txHost.tx.promotion.findUnique({
      where: { id },
      include: TARGETS_IN_ORDER,
    });
    if (row === null) return null;
    return {
      id: toId<'Promotion'>(row.id),
      ...toTerms(row),
      endedAt: row.endedAt,
      endedBy: row.endedBy === null ? null : toId<'User'>(row.endedBy),
      uses: row.uses,
      createdBy: toId<'User'>(row.createdBy),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      version: row.version,
    };
  }

  async listPromotions(
    filter: PromotionFilter,
    sort: readonly SortOrder<PromotionSortField>[],
    page: PageRequest,
    at: Date,
  ): Promise<Page<PromotionSummaryView>> {
    const where: Prisma.PromotionWhereInput = {
      AND: [
        filter.q === undefined
          ? {}
          : {
              OR: [
                { name: { contains: filter.q.trim(), mode: 'insensitive' } },
                { code: normalizedCouponCode(filter.q) },
              ],
            },
        filter.status === undefined
          ? {}
          : { OR: filter.status.map((status) => statusWhere(status, at)) },
        filter.channel === undefined
          ? {}
          : filter.channel === 'ONLINE'
            ? { online: true }
            : { inStore: true },
        filter.appliesTo === undefined
          ? {}
          : filter.appliesTo === 'ORDER'
            ? { targets: { none: {} } }
            : { targets: { some: {} } },
        filter.kind === undefined
          ? {}
          : filter.kind === 'AUTOMATIC'
            ? { code: null }
            : { code: { not: null } },
      ],
    };
    const [rows, totalItems] = await Promise.all([
      this.txHost.tx.promotion.findMany({
        where,
        include: { _count: { select: { targets: true } } },
        orderBy: [
          ...sort.map(({ field, direction }) => ({ [field]: direction })),
          { id: 'asc' as const },
        ],
        skip: pageOffset(page),
        take: page.pageSize,
      }),
      this.txHost.tx.promotion.count({ where }),
    ]);
    return {
      items: rows.map((row) => ({
        id: toId<'Promotion'>(row.id),
        name: row.name,
        discount: discountOf(row),
        targetCount: row._count.targets,
        channels: channelsOf(row),
        minimumSubtotal:
          row.minimumSubtotal === null
            ? null
            : Money.of(row.minimumSubtotal, 'MXN'),
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        endedAt: row.endedAt,
        code: row.code,
        usageLimit: row.usageLimit,
        oncePerCustomer: row.oncePerCustomer,
        uses: row.uses,
      })),
      totalItems,
    };
  }
}

/** The promotions in this status at `at`, as `promotionStatus` decides it. */
function statusWhere(
  status: PromotionStatus,
  at: Date,
): Prisma.PromotionWhereInput {
  switch (status) {
    case 'SCHEDULED':
      return { endedAt: null, startsAt: { gt: at } };
    case 'ACTIVE':
      return {
        endedAt: null,
        startsAt: { lte: at },
        OR: [{ endsAt: null }, { endsAt: { gt: at } }],
      };
    case 'ENDED':
      return { OR: [{ endedAt: { not: null } }, { endsAt: { lte: at } }] };
  }
}
