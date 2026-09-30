import { Inject, Injectable } from '@nestjs/common';
import { ProductImageFile } from '../domain/product-image-file.js';

/** Dependency injection token of the largest image accepted, in bytes (`IMAGE_MAX_BYTES`). */
export const IMAGE_MAX_BYTES = Symbol('IMAGE_MAX_BYTES');

/**
 * Checks an uploaded file against BR-PRD-08 with the configured limit. The upload is already cut at that
 * limit while it is received (ADR-0121); this check is the rule itself.
 */
@Injectable()
export class ProductImageFiles {
  constructor(@Inject(IMAGE_MAX_BYTES) private readonly maxBytes: number) {}

  /** @throws ImageTooLargeError or UnsupportedImageFormatError. */
  read(bytes: Uint8Array): ProductImageFile {
    return ProductImageFile.of(bytes, this.maxBytes);
  }
}
