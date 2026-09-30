import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import { toId } from '../../../shared-kernel/index.js';
import {
  type GalleryImage,
  ProductGallery,
} from '../domain/product-gallery.js';
import { ProductGalleryRepository } from '../domain/product-gallery.repository.js';
import type { ProductId } from '../domain/product-id.js';
import type { ImageContentType } from '../domain/product-image-file.js';

/** `product_images` (DATABASE.md §4.6), always through the active transaction. */
@Injectable()
export class PrismaProductGalleryRepository extends ProductGalleryRepository {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  find(productId: ProductId): Promise<ProductGallery | null> {
    return this.load(productId);
  }

  async lock(productId: ProductId): Promise<ProductGallery | null> {
    await this.txHost.tx
      .$queryRaw`SELECT id FROM products WHERE id = ${productId}::uuid FOR UPDATE`;
    return this.load(productId);
  }

  async save(gallery: ProductGallery): Promise<void> {
    const tx = this.txHost.tx;
    const stored = new Map(
      (await this.images(gallery.productId)).map((image) => [image.id, image]),
    );
    const kept = new Set<string>();
    for (const image of gallery.images()) {
      kept.add(image.id);
      const before = stored.get(image.id);
      const changes = {
        altText: image.altText,
        variantId: image.variantId,
        position: image.position,
      };
      if (before === undefined) {
        await tx.productImage.create({
          data: {
            id: image.id,
            productId: gallery.productId,
            storageKey: image.storageKey,
            contentType: image.contentType,
            sizeBytes: image.sizeBytes,
            ...changes,
          },
        });
      } else if (
        before.altText !== image.altText ||
        before.variantId !== image.variantId ||
        before.position !== image.position
      ) {
        await tx.productImage.update({
          where: { id: image.id },
          data: changes,
        });
      }
    }
    const removed = [...stored.keys()].filter((id) => !kept.has(id));
    if (removed.length > 0) {
      await tx.productImage.deleteMany({ where: { id: { in: removed } } });
    }
    // Recently edited in the administration, without a new version: images do not need one (ADR-0071).
    // The time comes from the application, as for every `@updatedAt` of Prisma: the clock of the database
    // may be behind, and the product would look edited before its last change.
    await tx.product.update({
      where: { id: gallery.productId },
      data: { updatedAt: new Date() },
    });
  }

  private async load(productId: ProductId): Promise<ProductGallery | null> {
    const product = await this.txHost.tx.product.findUnique({
      where: { id: productId },
      select: { status: true, variants: { select: { id: true } } },
    });
    if (product === null) return null;
    return ProductGallery.of({
      productId,
      productStatus: product.status,
      variantIds: product.variants.map(({ id }) => toId<'Variant'>(id)),
      images: await this.images(productId),
    });
  }

  private async images(productId: ProductId): Promise<GalleryImage[]> {
    const rows = await this.txHost.tx.productImage.findMany({
      where: { productId },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({
      id: toId<'ProductImage'>(row.id),
      storageKey: row.storageKey,
      contentType: row.contentType as ImageContentType,
      sizeBytes: row.sizeBytes,
      altText: row.altText,
      variantId: row.variantId === null ? null : toId<'Variant'>(row.variantId),
      position: row.position,
    }));
  }
}
