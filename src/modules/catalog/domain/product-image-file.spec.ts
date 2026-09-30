import { newId } from '../../../shared-kernel/index.js';
import type { ProductId } from './product-id.js';
import {
  imageContentTypeOf,
  ImageTooLargeError,
  isProductImageKey,
  MAX_IMAGE_BYTES,
  newProductImageKey,
  ProductImageFile,
  UnsupportedImageFormatError,
} from './product-image-file.js';

/** The first bytes of each format, then some filler: the check reads only the signature. */
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
]);
const WEBP = Uint8Array.from([
  ...Buffer.from('RIFF'),
  0x24,
  0x00,
  0x00,
  0x00,
  ...Buffer.from('WEBPVP8 '),
]);

const text = (value: string) => Uint8Array.from(Buffer.from(value));
const filled = (size: number) => {
  const bytes = new Uint8Array(size);
  bytes.set(JPEG);
  return bytes;
};

describe('Product image files (BR-PRD-08, ADR-0121)', () => {
  describe('imageContentTypeOf', () => {
    it.each([
      ['JPEG', JPEG, 'image/jpeg'],
      ['PNG', PNG, 'image/png'],
      ['WebP', WEBP, 'image/webp'],
    ])('recognizes %s by its first bytes', (_, bytes, type) => {
      expect(imageContentTypeOf(bytes)).toBe(type);
    });

    it.each([
      ['an empty file', new Uint8Array()],
      ['a cut JPEG signature', JPEG.slice(0, 2)],
      ['a cut PNG signature', PNG.slice(0, 7)],
      ['a RIFF file that is not WebP', text('RIFF\x24\x00\x00\x00WAVEfmt ')],
      ['a cut WebP signature', WEBP.slice(0, 11)],
      ['a GIF', text('GIF89a')],
      ['a PDF', text('%PDF-1.7')],
      ['an SVG, which can carry scripts', text('<svg onload="alert(1)">')],
      ['HTML', text('<!doctype html>')],
      ['a JPEG signature further in', Uint8Array.from([0x00, ...JPEG])],
    ])('rejects %s', (_, bytes) => {
      expect(imageContentTypeOf(bytes)).toBeNull();
    });
  });

  describe('ProductImageFile.of', () => {
    it('keeps the bytes with their type, size and extension', () => {
      const file = ProductImageFile.of(WEBP, 1_000);

      expect(file.bytes).toBe(WEBP);
      expect(file.contentType).toBe('image/webp');
      expect(file.sizeBytes).toBe(WEBP.length);
      expect(file.extension).toBe('webp');
      expect(ProductImageFile.of(JPEG, 1_000).extension).toBe('jpg');
      expect(ProductImageFile.of(PNG, 1_000).extension).toBe('png');
    });

    it('accepts a file of exactly the limit and rejects one byte more', () => {
      expect(ProductImageFile.of(filled(100), 100).sizeBytes).toBe(100);
      expect(() => ProductImageFile.of(filled(101), 100)).toThrow(
        ImageTooLargeError,
      );
    });

    it('never goes above the limit of the database, whatever the configuration says', () => {
      expect(
        ProductImageFile.of(filled(MAX_IMAGE_BYTES), MAX_IMAGE_BYTES * 2)
          .sizeBytes,
      ).toBe(MAX_IMAGE_BYTES);
      expect(() =>
        ProductImageFile.of(filled(MAX_IMAGE_BYTES + 1), MAX_IMAGE_BYTES * 2),
      ).toThrow(ImageTooLargeError);
    });

    it('rejects another format, checking the size first', () => {
      expect(() => ProductImageFile.of(text('%PDF-1.7'), 100)).toThrow(
        UnsupportedImageFormatError,
      );
      expect(() => ProductImageFile.of(new Uint8Array(101), 100)).toThrow(
        ImageTooLargeError,
      );
    });

    it('answers the size with 413 and the format with 415, by category', () => {
      expect(new ImageTooLargeError(100)).toMatchObject({
        code: 'payload-too-large',
        category: 'too-large',
      });
      expect(new UnsupportedImageFormatError()).toMatchObject({
        code: 'unsupported-media-type',
        category: 'unsupported',
      });
    });
  });

  describe('storage keys (ADR-0024)', () => {
    const productId = newId<'Product'>() as ProductId;

    it('names a new image under its product, with a new ID and the extension of its format', () => {
      const first = newProductImageKey(
        productId,
        ProductImageFile.of(PNG, 1_000),
      );
      const second = newProductImageKey(
        productId,
        ProductImageFile.of(PNG, 1_000),
      );

      expect(first).toMatch(
        new RegExp(`^products/${productId}/[0-9a-f-]{36}\\.png$`),
      );
      expect(second).not.toBe(first);
      expect(isProductImageKey(first)).toBe(true);
    });

    it.each([
      `products/${newId()}/${newId()}.gif`,
      `products/${newId()}/${newId()}.jpg.exe`,
      `products/${newId()}/../${newId()}.jpg`,
      `products/../../etc/${newId()}.jpg`,
      `/products/${newId()}/${newId()}.jpg`,
      `products\\${newId()}\\${newId()}.jpg`,
      `products/${newId()}/.uploading.jpg`,
      `other/${newId()}/${newId()}.jpg`,
      '',
    ])('rejects the key %p', (key) => {
      expect(isProductImageKey(key)).toBe(false);
    });
  });
});
