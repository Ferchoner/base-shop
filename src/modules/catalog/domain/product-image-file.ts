import { DomainError, newId } from '../../../shared-kernel/index.js';
import type { ProductId } from './product-id.js';

/** Formats a product image may have (BR-PRD-08, ADR-0024). */
export type ImageContentType = 'image/jpeg' | 'image/png' | 'image/webp';

/**
 * Largest image the system can keep: the `CHECK` of `product_images.size_bytes` (DATABASE.md §4.6).
 * `IMAGE_MAX_BYTES` can lower it; raising it needs a migration first.
 */
export const MAX_IMAGE_BYTES = 5_242_880;

const EXTENSIONS: Readonly<Record<ImageContentType, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** `true` when `bytes` holds `expected` from `offset` on. */
function startsWith(
  bytes: Uint8Array,
  expected: readonly number[],
  offset = 0,
): boolean {
  return (
    bytes.length >= offset + expected.length &&
    expected.every((byte, index) => bytes[offset + index] === byte)
  );
}

const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** "RIFF", then four bytes of length, then "WEBP". */
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

/**
 * The format of an image by its first bytes, never by its file name or by the type the client declares
 * (SECURITY.md, "Subida de archivos"); `null` for any other content.
 */
export function imageContentTypeOf(bytes: Uint8Array): ImageContentType | null {
  if (startsWith(bytes, JPEG)) return 'image/jpeg';
  if (startsWith(bytes, PNG)) return 'image/png';
  if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8)) {
    return 'image/webp';
  }
  return null;
}

/** The file is not a JPEG, PNG or WebP image (BR-PRD-08, E-22). Answered 415 `unsupported-media-type`. */
export class UnsupportedImageFormatError extends DomainError {
  readonly code = 'unsupported-media-type';
  readonly category = 'unsupported';

  constructor() {
    super('The file is not a JPEG, PNG or WebP image');
  }
}

/**
 * The image is larger than the limit (BR-PRD-08, E-22). Answered 413 `payload-too-large` with `maxBytes`
 * (API_SPEC.md §6.2).
 */
export class ImageTooLargeError extends DomainError {
  readonly code = 'payload-too-large';
  readonly category = 'too-large';

  constructor(maxBytes: number) {
    super(`The image is larger than ${maxBytes} bytes`, { maxBytes });
  }
}

/**
 * The content of a product image, checked against BR-PRD-08: JPEG, PNG or WebP by its first bytes, and no
 * larger than the configured limit. Only the signature is checked; the image is not decoded or rewritten
 * (ADR-0121).
 */
export class ProductImageFile {
  private constructor(
    readonly bytes: Uint8Array,
    readonly contentType: ImageContentType,
  ) {}

  /**
   * @param maxBytes the configured limit (`IMAGE_MAX_BYTES`), never above `MAX_IMAGE_BYTES`.
   * @throws ImageTooLargeError or UnsupportedImageFormatError.
   */
  static of(bytes: Uint8Array, maxBytes: number): ProductImageFile {
    const limit = Math.min(maxBytes, MAX_IMAGE_BYTES);
    if (bytes.length > limit) throw new ImageTooLargeError(limit);
    const contentType = imageContentTypeOf(bytes);
    if (contentType === null) throw new UnsupportedImageFormatError();
    return new ProductImageFile(bytes, contentType);
  }

  get sizeBytes(): number {
    return this.bytes.length;
  }

  get extension(): string {
    return EXTENSIONS[this.contentType];
  }
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** `products/<product id>/<image id>.<jpg|png|webp>`: the only shape a stored image key has. */
const PRODUCT_IMAGE_KEY = new RegExp(
  `^products/${UUID}/${UUID}\\.(?:jpg|png|webp)$`,
);

/**
 * The storage key of a new image (ADR-0024, ADR-0121): the server chooses it, never from the name the client
 * sent, so an upload cannot overwrite another file or climb out of the image folder.
 */
export function newProductImageKey(
  productId: ProductId,
  file: ProductImageFile,
): string {
  return `products/${productId}/${newId()}.${file.extension}`;
}

export function isProductImageKey(key: string): boolean {
  return PRODUCT_IMAGE_KEY.test(key);
}
