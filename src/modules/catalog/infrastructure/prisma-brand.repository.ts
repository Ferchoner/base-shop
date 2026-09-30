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
import { Brand, type BrandId } from '../domain/brand.js';
import { BrandRepository } from '../domain/brand.repository.js';

/** `brands` (DATABASE.md §4.1), always through the active transaction. */
@Injectable()
export class PrismaBrandRepository extends BrandRepository {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  async findById(id: BrandId): Promise<Brand | null> {
    const row = await this.txHost.tx.brand.findUnique({ where: { id } });
    return row === null
      ? null
      : Brand.restore({
          id: toId<'Brand'>(row.id),
          name: row.name,
          slug: row.slug,
          status: row.status,
        });
  }

  async save(brand: Brand): Promise<void> {
    const { id, ...data } = brand.snapshot();
    try {
      await this.txHost.tx.brand.upsert({
        where: { id },
        create: { id, ...data },
        update: data,
      });
    } catch (error) {
      const index = uniqueViolationIndex(error);
      if (index === 'brands_slug_key') throw new DuplicateValueError('slug');
      if (index === 'brands_name_lower_key') {
        throw new DuplicateValueError('name');
      }
      throw error;
    }
  }

  async delete(brand: Brand): Promise<void> {
    try {
      await this.txHost.tx.brand.delete({ where: { id: brand.id } });
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new ResourceInUseError(`Brand ${brand.id} has products`);
      }
      throw error;
    }
  }

  async takenSlugs(slugs: readonly string[]): Promise<ReadonlySet<string>> {
    const rows = await this.txHost.tx.brand.findMany({
      select: { slug: true },
      where: { slug: { in: [...slugs] } },
    });
    return new Set(rows.map((row) => row.slug));
  }
}
