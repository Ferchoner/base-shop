import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { Prisma } from '../../../platform/persistence/prisma/generated/client.js';
import { isUniqueViolation } from '../../../platform/persistence/prisma-errors.js';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import {
  DuplicateValueError,
  toId,
  VersionConflictError,
} from '../../../shared-kernel/index.js';
import {
  Promotion,
  type PromotionChannel,
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
 * replaces the targets only when they changed. The uses of a coupon change apart, with an `UPDATE` that locks the row
 * and checks the limit in the same statement, so they never cross a change of the staff (ADR-0168). The unique index
 * on `code` answers a code taken as a duplicate. Dates come from the application, never from the database clock.
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
    await withUniqueCode(() =>
      this.txHost.tx.promotion.create({
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
      }),
    );
  }

  async find(id: PromotionId): Promise<Promotion | null> {
    const row = await this.txHost.tx.promotion.findUnique({
      where: { id },
      include: TARGETS_IN_ORDER,
    });
    return row === null ? null : Promotion.restore(toSnapshot(row));
  }

  async findByCode(code: string): Promise<Promotion | null> {
    const row = await this.txHost.tx.promotion.findUnique({
      where: { code },
      include: TARGETS_IN_ORDER,
    });
    return row === null ? null : Promotion.restore(toSnapshot(row));
  }

  async activeAt(at: Date, channel: PromotionChannel): Promise<Promotion[]> {
    const rows = await this.txHost.tx.promotion.findMany({
      where: {
        code: null,
        endedAt: null,
        startsAt: { lte: at },
        OR: [{ endsAt: null }, { endsAt: { gt: at } }],
        ...(channel === 'ONLINE' ? { online: true } : { inStore: true }),
      },
      include: TARGETS_IN_ORDER,
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => Promotion.restore(toSnapshot(row)));
  }

  async save(promotion: Promotion, now: Date): Promise<void> {
    const p = promotion.snapshot;
    const tx = this.txHost.tx;
    const { count } = await withUniqueCode(() =>
      tx.promotion.updateMany({
        where: { id: p.id, version: p.version },
        data: {
          ...termsOf(p),
          endedAt: p.endedAt,
          endedBy: p.endedBy,
          version: { increment: 1 },
          updatedAt: now,
        },
      }),
    );
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

  async addUse(
    id: PromotionId,
    options: { readonly beyondLimit: boolean },
  ): Promise<boolean> {
    const counted = await this.txHost.tx.$executeRaw`
      UPDATE promotions SET uses = uses + 1
       WHERE id = ${id}::uuid
         AND (${options.beyondLimit}::boolean OR usage_limit IS NULL OR uses < usage_limit)`;
    return counted === 1;
  }

  async removeUse(id: PromotionId): Promise<void> {
    await this.txHost.tx.$executeRaw`
      UPDATE promotions SET uses = uses - 1 WHERE id = ${id}::uuid AND uses > 0`;
  }
}

/** @throws DuplicateValueError on `code` when the unique index on it answers. */
async function withUniqueCode<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateValueError('code');
    throw error;
  }
}

function toSnapshot(row: PromotionRow): PromotionSnapshot {
  return {
    id: toId<'Promotion'>(row.id),
    ...toTerms(row),
    createdBy: toId<'User'>(row.createdBy),
    endedAt: row.endedAt,
    endedBy: row.endedBy === null ? null : toId<'User'>(row.endedBy),
    uses: row.uses,
    version: row.version,
  };
}
