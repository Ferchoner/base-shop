import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { Prisma } from '../../../platform/persistence/prisma/generated/client.js';
import {
  isForeignKeyViolation,
  uniqueViolationIndex,
} from '../../../platform/persistence/prisma-errors.js';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import {
  DuplicateValueError,
  toId,
  VersionConflictError,
} from '../../../shared-kernel/index.js';
import { Product } from '../domain/product.js';
import {
  UnusableBrandError,
  UnusableCategoriesError,
} from '../domain/product-errors.js';
import type { ProductId } from '../domain/product-id.js';
import { ProductRepository } from '../domain/product.repository.js';
import {
  gtinKey,
  sameOptions,
  type VariantOptions,
  type VariantSnapshot,
} from '../domain/variant.js';

const WITH_PARTS = {
  categories: { select: { categoryId: true } },
  variants: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
} as const satisfies Prisma.ProductInclude;

type ProductRow = Prisma.ProductGetPayload<{ include: typeof WITH_PARTS }>;
type VariantRow = ProductRow['variants'][number];

/** Unique indexes and the field they protect (DATABASE.md §4.3 and §4.5). */
const DUPLICATE_FIELDS: Readonly<Record<string, string>> = {
  products_slug_key: 'slug',
  product_variants_sku_key: 'sku',
  product_variants_active_options_key: 'options',
  product_variants_active_gtin_key: 'gtin',
};

/** `products`, `product_categories` and `product_variants`, always through the active transaction. */
@Injectable()
export class PrismaProductRepository extends ProductRepository {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  async findById(id: ProductId): Promise<Product | null> {
    const row = await this.txHost.tx.product.findUnique({
      where: { id },
      include: WITH_PARTS,
    });
    return row === null ? null : toProduct(row);
  }

  async save(product: Product): Promise<void> {
    try {
      await this.write(product);
    } catch (error) {
      const field = DUPLICATE_FIELDS[uniqueViolationIndex(error) ?? ''];
      if (field !== undefined) throw new DuplicateValueError(field);
      throw error;
    }
  }

  /**
   * Three statements that take arrays (ADR-0164), like the bulk import of prices (ADR-0126): `createMany` builds
   * every row in the client, and took 8 s for 5,000 products with 10 categories each.
   */
  async insertNew(products: readonly Product[], now: Date): Promise<void> {
    if (products.length === 0) return;
    const tx = this.txHost.tx;
    const states = products.map((product) => product.snapshot());
    const links = states.flatMap((state) =>
      state.categoryIds.map((categoryId) => ({
        productId: state.id,
        categoryId,
      })),
    );
    const variants = states.flatMap((state) =>
      state.variants.map((variant) => ({ productId: state.id, variant })),
    );
    try {
      try {
        await tx.$executeRaw`
          INSERT INTO products (id, title, slug, description, brand_id, status, version, created_at, updated_at)
          SELECT row.id, row.title, row.slug, row.description, row.brand_id, row.status, row.version, ${now}, ${now}
            FROM unnest(
                   ${states.map(({ id }) => id)}::uuid[],
                   ${states.map(({ title }) => title)}::text[],
                   ${states.map(({ slug }) => slug)}::text[],
                   ${states.map(({ description }) => description)}::text[],
                   ${states.map(({ brandId }) => brandId)}::uuid[],
                   ${states.map(({ status }) => status)}::product_status[],
                   ${states.map(({ version }) => version)}::integer[]
                 ) AS row(id, title, slug, description, brand_id, status, version)`;
      } catch (error) {
        // A brand was deleted after it was checked.
        if (isForeignKeyViolation(error)) {
          throw new UnusableBrandError('unknown');
        }
        throw error;
      }
      try {
        await tx.$executeRaw`
          INSERT INTO product_categories (product_id, category_id)
          SELECT row.product_id, row.category_id
            FROM unnest(
                   ${links.map(({ productId }) => productId)}::uuid[],
                   ${links.map(({ categoryId }) => categoryId)}::uuid[]
                 ) AS row(product_id, category_id)`;
      } catch (error) {
        // A category was deleted after it was checked.
        if (isForeignKeyViolation(error)) {
          throw new UnusableCategoriesError('unknown');
        }
        throw error;
      }
      const measure = (value: number | null) =>
        value === null ? null : String(value);
      await tx.$executeRaw`
        INSERT INTO product_variants (id, product_id, sku, gtin, gtin_key, options, status, weight_grams,
                                      length_cm, width_cm, height_cm, created_at, updated_at)
        SELECT row.id, row.product_id, row.sku, row.gtin, row.gtin_key, row.options::jsonb, row.status,
               row.weight_grams, row.length_cm, row.width_cm, row.height_cm, ${now}, ${now}
          FROM unnest(
                 ${variants.map(({ variant }) => variant.id)}::uuid[],
                 ${variants.map(({ productId }) => productId)}::uuid[],
                 ${variants.map(({ variant }) => variant.sku)}::text[],
                 ${variants.map(({ variant }) => variant.gtin)}::text[],
                 ${variants.map(({ variant }) => (variant.gtin === null ? null : gtinKey(variant.gtin)))}::text[],
                 ${variants.map(({ variant }) => JSON.stringify(variant.options))}::text[],
                 ${variants.map(({ variant }) => variant.status)}::variant_status[],
                 ${variants.map(({ variant }) => variant.weightGrams)}::integer[],
                 ${variants.map(({ variant }) => measure(variant.lengthCm))}::numeric[],
                 ${variants.map(({ variant }) => measure(variant.widthCm))}::numeric[],
                 ${variants.map(({ variant }) => measure(variant.heightCm))}::numeric[]
               ) AS row(id, product_id, sku, gtin, gtin_key, options, status, weight_grams, length_cm,
                        width_cm, height_cm)`;
    } catch (error) {
      const field = DUPLICATE_FIELDS[uniqueViolationIndex(error) ?? ''];
      if (field !== undefined) throw new DuplicateValueError(field);
      throw error;
    }
  }

  async takenSkus(skus: readonly string[]): Promise<ReadonlySet<string>> {
    if (skus.length === 0) return new Set();
    const rows = await this.txHost.tx.productVariant.findMany({
      select: { sku: true },
      where: { sku: { in: [...skus] } },
    });
    return new Set(rows.map((row) => row.sku));
  }

  async takenGtinKeys(keys: readonly string[]): Promise<ReadonlySet<string>> {
    if (keys.length === 0) return new Set();
    const rows = await this.txHost.tx.productVariant.findMany({
      select: { gtinKey: true },
      where: { gtinKey: { in: [...keys] }, status: 'ACTIVE' },
    });
    return new Set(
      rows.flatMap(({ gtinKey }) => (gtinKey === null ? [] : [gtinKey])),
    );
  }

  async takenSlugs(slugs: readonly string[]): Promise<ReadonlySet<string>> {
    const rows = await this.txHost.tx.product.findMany({
      select: { slug: true },
      where: { slug: { in: [...slugs] } },
    });
    return new Set(rows.map((row) => row.slug));
  }

  private async write(product: Product): Promise<void> {
    const tx = this.txHost.tx;
    const state = product.snapshot();
    const data = {
      title: state.title,
      slug: state.slug,
      description: state.description,
      brandId: state.brandId,
      status: state.status,
      publishedAt: state.publishedAt,
      archivedAt: state.archivedAt,
      firstPublishedAt: state.firstPublishedAt,
    };
    let saved: number;
    try {
      ({ count: saved } = await tx.product.updateMany({
        where: { id: state.id, version: state.version },
        data: { ...data, version: { increment: 1 } },
      }));
      if (saved === 0) {
        const current = await tx.product.findUnique({
          where: { id: state.id },
          select: { version: true },
        });
        if (current !== null) throw new VersionConflictError(current.version);
        await tx.product.create({ data: { id: state.id, ...data } });
      }
    } catch (error) {
      // The brand was deleted after it was checked.
      if (isForeignKeyViolation(error)) throw new UnusableBrandError('unknown');
      throw error;
    }
    await this.writeCategories(state.id, state.categoryIds);
    await this.writeVariants(state.id, state.variants);
    if (saved > 0) product.markSaved(state.version + 1);
  }

  private async writeCategories(
    productId: string,
    categoryIds: readonly string[],
  ): Promise<void> {
    const tx = this.txHost.tx;
    await tx.productCategory.deleteMany({
      where: { productId, categoryId: { notIn: [...categoryIds] } },
    });
    if (categoryIds.length === 0) return;
    try {
      await tx.productCategory.createMany({
        data: categoryIds.map((categoryId) => ({ productId, categoryId })),
        skipDuplicates: true,
      });
    } catch (error) {
      // A category was deleted after it was checked.
      if (isForeignKeyViolation(error)) {
        throw new UnusableCategoriesError('unknown');
      }
      throw error;
    }
  }

  /** Writes only the variants that are new or changed, so the others keep their `updated_at`. */
  private async writeVariants(
    productId: string,
    variants: readonly VariantSnapshot[],
  ): Promise<void> {
    const tx = this.txHost.tx;
    const stored = new Map(
      (await tx.productVariant.findMany({ where: { productId } })).map(
        (row) => [row.id, toVariant(row)],
      ),
    );
    for (const variant of variants) {
      const before = stored.get(variant.id);
      const data = variantData(variant);
      if (before === undefined) {
        await tx.productVariant.create({
          data: { id: variant.id, productId, ...data },
        });
      } else if (!sameVariant(before, variant)) {
        await tx.productVariant.update({ where: { id: variant.id }, data });
      }
    }
  }
}

/** The columns of a variant, but its ID and product. */
function variantData(variant: VariantSnapshot) {
  return {
    sku: variant.sku,
    gtin: variant.gtin,
    gtinKey: variant.gtin === null ? null : gtinKey(variant.gtin),
    options: variant.options,
    status: variant.status,
    weightGrams: variant.weightGrams,
    lengthCm: variant.lengthCm,
    widthCm: variant.widthCm,
    heightCm: variant.heightCm,
  };
}

function toProduct(row: ProductRow): Product {
  return Product.restore({
    id: toId<'Product'>(row.id),
    title: row.title,
    slug: row.slug,
    description: row.description,
    brandId: row.brandId === null ? null : toId<'Brand'>(row.brandId),
    categoryIds: row.categories.map(({ categoryId }) =>
      toId<'Category'>(categoryId),
    ),
    status: row.status,
    publishedAt: row.publishedAt,
    archivedAt: row.archivedAt,
    firstPublishedAt: row.firstPublishedAt,
    variants: row.variants.map(toVariant),
    version: row.version,
  });
}

/** Whether a stored variant already has these values; `jsonb` may list the options in another order. */
function sameVariant(a: VariantSnapshot, b: VariantSnapshot): boolean {
  return (
    a.sku === b.sku &&
    a.gtin === b.gtin &&
    a.status === b.status &&
    a.weightGrams === b.weightGrams &&
    a.lengthCm === b.lengthCm &&
    a.widthCm === b.widthCm &&
    a.heightCm === b.heightCm &&
    sameOptions(a.options, b.options)
  );
}

function toVariant(row: VariantRow): VariantSnapshot {
  return {
    id: toId<'Variant'>(row.id),
    sku: row.sku,
    gtin: row.gtin,
    options: row.options as VariantOptions,
    status: row.status,
    weightGrams: row.weightGrams,
    lengthCm: row.lengthCm === null ? null : row.lengthCm.toNumber(),
    widthCm: row.widthCm === null ? null : row.widthCm.toNumber(),
    heightCm: row.heightCm === null ? null : row.heightCm.toNumber(),
  };
}
