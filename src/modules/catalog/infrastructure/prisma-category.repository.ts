import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import {
  isForeignKeyViolation,
  uniqueViolationIndex,
} from '../../../platform/persistence/prisma-errors.js';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import {
  DuplicateValueError,
  ResourceInUseError,
  toId,
} from '../../../shared-kernel/index.js';
import { UnusableParentError } from '../domain/catalog-errors.js';
import { Category, type CategoryId } from '../domain/category.js';
import { CategoryRepository } from '../domain/category.repository.js';

/**
 * Key of the transaction-level advisory lock of the category tree (ADR-0120): "CATT" in ASCII, so it does
 * not collide with a lock another part of the system may take.
 */
export const CATEGORY_TREE_LOCK = 0x43415454;

/** `categories` (DATABASE.md §4.2), always through the active transaction. */
@Injectable()
export class PrismaCategoryRepository extends CategoryRepository {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  async findById(id: CategoryId): Promise<Category | null> {
    const row = await this.txHost.tx.category.findUnique({ where: { id } });
    return row === null ? null : toCategory(row);
  }

  async findByIds(ids: readonly CategoryId[]): Promise<Category[]> {
    if (ids.length === 0) return [];
    const rows = await this.txHost.tx.category.findMany({
      where: { id: { in: [...ids] } },
    });
    return rows.map(toCategory);
  }

  async save(category: Category): Promise<void> {
    const { id, ...data } = category.snapshot();
    try {
      await this.txHost.tx.category.upsert({
        where: { id },
        create: { id, ...data },
        update: data,
      });
    } catch (error) {
      const index = uniqueViolationIndex(error);
      if (index === 'categories_slug_key') {
        throw new DuplicateValueError('slug');
      }
      if (index === 'categories_parent_name_lower_key') {
        throw new DuplicateValueError('name');
      }
      // The parent was deleted after it was checked.
      if (isForeignKeyViolation(error))
        throw new UnusableParentError('unknown');
      throw error;
    }
  }

  async delete(category: Category): Promise<void> {
    try {
      await this.txHost.tx.category.delete({ where: { id: category.id } });
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new ResourceInUseError(
          `Category ${category.id} has subcategories or products`,
        );
      }
      throw error;
    }
  }

  async lineage(id: CategoryId): Promise<CategoryId[]> {
    // UNION, not UNION ALL, so the walk would stop even on a cycle that BR-PRD-03 never lets exist.
    const rows = await this.txHost.tx.$queryRaw<{ id: string }[]>`
      WITH RECURSIVE lineage (id, parent_id) AS (
        SELECT id, parent_id FROM categories WHERE id = ${id}::uuid
        UNION
        SELECT c.id, c.parent_id FROM categories c JOIN lineage l ON c.id = l.parent_id
      )
      SELECT id FROM lineage`;
    return rows.map((row) => toId<'Category'>(row.id));
  }

  async takenSlugs(slugs: readonly string[]): Promise<ReadonlySet<string>> {
    const rows = await this.txHost.tx.category.findMany({
      select: { slug: true },
      where: { slug: { in: [...slugs] } },
    });
    return new Set(rows.map((row) => row.slug));
  }

  async lockTree(): Promise<void> {
    // $executeRaw, because Prisma cannot read the `void` value that the function returns.
    await this.txHost.tx
      .$executeRaw`SELECT pg_advisory_xact_lock(${CATEGORY_TREE_LOCK}::bigint)`;
  }
}

function toCategory(row: {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  status: 'ACTIVE' | 'INACTIVE';
  position: number;
}): Category {
  return Category.restore({
    id: toId<'Category'>(row.id),
    parentId: row.parentId === null ? null : toId<'Category'>(row.parentId),
    name: row.name,
    slug: row.slug,
    status: row.status,
    position: row.position,
  });
}
