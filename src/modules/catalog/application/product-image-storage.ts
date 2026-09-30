import type { ProductImageFile } from '../domain/product-image-file.js';

/**
 * Where product images live (ADR-0024, ADR-0121): the server's disk for now, a CDN later, without touching the
 * domain or the data. The database keeps only the key; the public URL is built when answering. An abstract
 * class rather than an interface, so it can be the dependency injection token without depending on NestJS.
 */
export abstract class ProductImageStorage {
  /** Stores the file under `key`, whole or not at all. */
  abstract save(key: string, file: ProductImageFile): Promise<void>;

  /** Removes the file. One that is already gone is not an error, so a retry after a failure is safe. */
  abstract delete(key: string): Promise<void>;

  /** The absolute public URL of the image. */
  abstract urlOf(key: string): string;
}
