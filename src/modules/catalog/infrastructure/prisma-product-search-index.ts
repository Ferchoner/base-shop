import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { Prisma } from '../../../platform/persistence/prisma/generated/client.js';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import { ProductSearchIndex } from '../application/product-search-index.js';
import type { BrandId } from '../domain/brand.js';
import type { CategoryId } from '../domain/category.js';
import type { ProductId } from '../domain/product-id.js';

/**
 * `products.search_vector` (ADR-0060, ADR-0080, ADR-0123), rebuilt with one `UPDATE` in the active transaction:
 * - weight A, the title; B, the name of the brand, active or not; C, the names of its visible categories;
 * - the Spanish text search configuration over the text without accents (`unaccent`), which the public search
 *   of T-140 part c uses on its side too.
 */
@Injectable()
export class PrismaProductSearchIndex extends ProductSearchIndex {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  async refreshProducts(ids: readonly ProductId[]): Promise<void> {
    if (ids.length === 0) return;
    await this.refresh(
      Prisma.empty,
      Prisma.sql`p.id = ANY(${[...ids]}::uuid[])`,
    );
  }

  async refreshCategories(ids: readonly CategoryId[]): Promise<void> {
    if (ids.length === 0) return;
    // The categories and every subcategory under them.
    const subtree = Prisma.sql`, subtree (id) AS (
      SELECT id FROM categories WHERE id = ANY(${[...ids]}::uuid[])
      UNION
      SELECT c.id FROM categories c JOIN subtree s ON c.parent_id = s.id
    )`;
    await this.refresh(
      subtree,
      Prisma.sql`p.id IN (
        SELECT pc.product_id FROM product_categories pc WHERE pc.category_id IN (SELECT id FROM subtree)
      )`,
    );
  }

  async refreshBrand(id: BrandId): Promise<void> {
    await this.refresh(Prisma.empty, Prisma.sql`p.brand_id = ${id}::uuid`);
  }

  private async refresh(
    extraCte: Prisma.Sql,
    where: Prisma.Sql,
  ): Promise<void> {
    // UNION, not UNION ALL, so the walk would stop even on a cycle that BR-PRD-03 never lets exist.
    await this.txHost.tx.$executeRaw`
      WITH RECURSIVE visible (id) AS (
        SELECT id FROM categories WHERE parent_id IS NULL AND status = 'ACTIVE'
        UNION
        SELECT c.id FROM categories c JOIN visible v ON c.parent_id = v.id WHERE c.status = 'ACTIVE'
      )${extraCte}
      UPDATE products p SET search_vector =
           setweight(to_tsvector('spanish', unaccent(p.title)), 'A')
        || setweight(to_tsvector('spanish', unaccent(coalesce(
             (SELECT b.name FROM brands b WHERE b.id = p.brand_id), ''))), 'B')
        || setweight(to_tsvector('spanish', unaccent(coalesce(
             (SELECT string_agg(c.name, ' ' ORDER BY c.name)
                FROM product_categories pc JOIN categories c ON c.id = pc.category_id
               WHERE pc.product_id = p.id AND c.id IN (SELECT id FROM visible)), ''))), 'C')
      WHERE ${where}`;
  }
}
