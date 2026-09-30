import type { ProductGallery } from './product-gallery.js';
import type { ProductId } from './product-id.js';

/**
 * The images of a product (DATABASE.md §4.6). An abstract class rather than an interface, so it can be the
 * dependency injection token without depending on NestJS.
 */
export abstract class ProductGalleryRepository {
  /** The gallery as it is now, without locking: to check a change before storing a file. */
  abstract find(productId: ProductId): Promise<ProductGallery | null>;

  /**
   * The gallery, with the product row locked until the transaction ends (`SELECT … FOR UPDATE`), so two changes
   * of the same gallery never run their checks at the same time (ADR-0124). `null` when the product is missing.
   */
  abstract lock(productId: ProductId): Promise<ProductGallery | null>;

  /**
   * Writes the images that were added, changed or removed, and marks the product as updated without touching
   * its `version` (ADR-0124).
   */
  abstract save(gallery: ProductGallery): Promise<void>;
}
