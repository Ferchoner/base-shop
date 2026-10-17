import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { Prisma } from '../../../platform/persistence/prisma/generated/client.js';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import { toId, VersionConflictError } from '../../../shared-kernel/index.js';
import {
  Promotion,
  type PromotionId,
  type PromotionSnapshot,
} from '../domain/promotion.js';
import { PromotionRepository } from '../domain/promotion.repository.js';
import {
  termsOf,
  TARGETS_IN_ORDER,
  targetsOf,
  toTerms,
} from './promotion-rows.js';

type PromotionRow = Prisma.PromotionGetPayload<{ include: { targets: true } }>;

/**
 * Promotions in PostgreSQL (DATABASE.md §18). A change saves only over the version it read (optimistic locking), and
 * replaces the targets only when they changed. Dates come from the application, never from the database clock.
 */
@Injectable()
export class PrismaPromotionRepository extends PromotionRepository {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  async insert(promotion: Promotion, now: Date): Promise<void> {
    const p = promotion.snapshot;
    await this.txHost.tx.promotion.create({
      data: {
        id: p.id,
        ...termsOf(p),
        createdBy: p.createdBy,
        endedAt: p.endedAt,
        endedBy: p.endedBy,
        version: p.version,
        createdAt: now,
        updatedAt: now,
        targets: { create: targetsOf(p.targets) },
      },
    });
  }

  async find(id: PromotionId): Promise<Promotion | null> {
    const row = await this.txHost.tx.promotion.findUnique({
      where: { id },
      include: TARGETS_IN_ORDER,
    });
    return row === null ? null : Promotion.restore(toSnapshot(row));
  }

  async save(promotion: Promotion, now: Date): Promise<void> {
    const p = promotion.snapshot;
    const tx = this.txHost.tx;
    const { count } = await tx.promotion.updateMany({
      where: { id: p.id, version: p.version },
      data: {
        ...termsOf(p),
        endedAt: p.endedAt,
        endedBy: p.endedBy,
        version: { increment: 1 },
        updatedAt: now,
      },
    });
    if (count === 0) {
      const current = await tx.promotion.findUniqueOrThrow({
        where: { id: p.id },
        select: { version: true },
      });
      throw new VersionConflictError(current.version);
    }
    if (promotion.targetsChanged) {
      await tx.promotionTarget.deleteMany({ where: { promotionId: p.id } });
      await tx.promotionTarget.createMany({
        data: targetsOf(p.targets).map((target) => ({
          ...target,
          promotionId: p.id,
        })),
      });
    }
  }
}

function toSnapshot(row: PromotionRow): PromotionSnapshot {
  return {
    id: toId<'Promotion'>(row.id),
    ...toTerms(row),
    createdBy: toId<'User'>(row.createdBy),
    endedAt: row.endedAt,
    endedBy: row.endedBy === null ? null : toId<'User'>(row.endedBy),
    version: row.version,
  };
}
