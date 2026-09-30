import { Injectable, Logger } from '@nestjs/common';
import {
  AuditTrail,
  changesBetween,
  newId,
  NotFoundError,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import type {
  GalleryImage,
  ProductGallery,
  ProductImageId,
} from '../domain/product-gallery.js';
import { ProductGalleryRepository } from '../domain/product-gallery.repository.js';
import type { ProductId } from '../domain/product-id.js';
import { newProductImageKey } from '../domain/product-image-file.js';
import type { VariantId } from '../domain/variant.js';
import type { ProductImageView } from './catalog.queries.js';
import { ProductImageFiles } from './product-image-files.js';
import { ProductImageStorage } from './product-image-storage.js';

function toView(image: GalleryImage): ProductImageView {
  const { id, storageKey, altText, position, variantId } = image;
  return { id, storageKey, altText, position, variantId };
}

/** What the audit trail keeps of an image. */
function auditedFields(image: GalleryImage): Record<string, unknown> {
  const { contentType, sizeBytes, altText, variantId, position } = image;
  return { contentType, sizeBytes, altText, variantId, position };
}

/**
 * Images of a product (UC-CAT-11, ADR-0121, ADR-0124). Each change locks the product row, so two changes of
 * one gallery run one after the other. Files and rows stay together:
 * - uploading stores the file first and then the row; if the row is not saved, the file is deleted;
 * - deleting removes the row first and the file after the commit; a file that cannot be deleted then is
 *   left behind and logged.
 */
@Injectable()
export class ProductImages {
  private readonly logger = new Logger(ProductImages.name);

  constructor(
    private readonly galleries: ProductGalleryRepository,
    private readonly files: ProductImageFiles,
    private readonly storage: ProductImageStorage,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
  ) {}

  /** Adds an image at the end of the gallery. */
  async upload(
    productId: ProductId,
    input: {
      bytes: Uint8Array;
      altText: string | null;
      variantId: VariantId | null;
    },
  ): Promise<ProductImageView> {
    const file = this.files.read(input.bytes);
    const image = {
      id: newId<'ProductImage'>(),
      storageKey: newProductImageKey(productId, file),
      contentType: file.contentType,
      sizeBytes: file.sizeBytes,
      altText: input.altText,
      variantId: input.variantId,
    };
    // Checked before storing the file, so a missing or archived product, a variant of another product or a
    // full gallery writes nothing; checked again under the lock below.
    (await this.found(this.galleries.find(productId), productId)).add(image);
    await this.storage.save(image.storageKey, file);
    try {
      return await this.transactions.run(async () => {
        const gallery = await this.locked(productId);
        const added = gallery.add(image);
        await this.galleries.save(gallery);
        await this.audit.record({
          action: 'products.image-add',
          resource: { type: 'product-image', id: added.id },
          changes: changesBetween({}, auditedFields(added)),
        });
        return toView(added);
      });
    } catch (error) {
      await this.deleteFile(image.storageKey);
      throw error;
    }
  }

  /** Changes the alternative text or the variant of an image. Without changes, nothing is saved or audited. */
  describe(
    productId: ProductId,
    imageId: ProductImageId,
    changes: { altText?: string | null; variantId?: VariantId | null },
  ): Promise<ProductImageView> {
    return this.transactions.run(async () => {
      const gallery = await this.locked(productId);
      const before = gallery.images().find(({ id }) => id === imageId);
      const described = gallery.describe(imageId, changes);
      const audited = changesBetween(
        before === undefined ? {} : auditedFields(before),
        auditedFields(described),
      );
      if (Object.keys(audited).length > 0) {
        await this.galleries.save(gallery);
        await this.audit.record({
          action: 'products.image-update',
          resource: { type: 'product-image', id: imageId },
          changes: audited,
        });
      }
      return toView(described);
    });
  }

  /** Puts every image of the product in a new order. The same order saves and audits nothing. */
  reorder(
    productId: ProductId,
    imageIds: readonly ProductImageId[],
  ): Promise<ProductImageView[]> {
    return this.transactions.run(async () => {
      const gallery = await this.locked(productId);
      const before = gallery.images().map(({ id }) => id);
      gallery.reorder(imageIds);
      const audited = changesBetween(
        { imageIds: before },
        { imageIds: gallery.images().map(({ id }) => id) },
      );
      if (Object.keys(audited).length > 0) {
        await this.galleries.save(gallery);
        await this.audit.record({
          action: 'products.image-reorder',
          resource: { type: 'product', id: productId },
          changes: audited,
        });
      }
      return gallery.images().map(toView);
    });
  }

  /** Deletes the row and, after the commit, the file (ADR-0038, ADR-0121). */
  async remove(productId: ProductId, imageId: ProductImageId): Promise<void> {
    const removed = await this.transactions.run(async () => {
      const gallery = await this.locked(productId);
      const image = gallery.remove(imageId);
      await this.galleries.save(gallery);
      await this.audit.record({
        action: 'products.image-delete',
        resource: { type: 'product-image', id: imageId },
        changes: changesBetween(auditedFields(image), {}),
      });
      return image;
    });
    await this.deleteFile(removed.storageKey);
  }

  private locked(productId: ProductId): Promise<ProductGallery> {
    return this.found(this.galleries.lock(productId), productId);
  }

  private async found(
    gallery: Promise<ProductGallery | null>,
    productId: ProductId,
  ): Promise<ProductGallery> {
    const found = await gallery;
    if (found === null) throw new NotFoundError('Product', productId);
    return found;
  }

  /** A file left behind takes disk space but breaks nothing, so the failure is logged and not answered. */
  private async deleteFile(storageKey: string): Promise<void> {
    try {
      await this.storage.delete(storageKey);
    } catch (error) {
      this.logger.warn(
        `Image file ${storageKey} was left behind: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
