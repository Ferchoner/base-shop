import { ImageTooLargeError } from '../domain/product-image-file.js';
import { ProductImageFiles } from './product-image-files.js';

const JPEG_START = [0xff, 0xd8, 0xff];

const jpegOf = (size: number) => {
  const bytes = new Uint8Array(size);
  bytes.set(JPEG_START);
  return bytes;
};

describe('ProductImageFiles (ADR-0121)', () => {
  it('checks an upload against the configured limit', () => {
    const files = new ProductImageFiles(10);

    expect(files.read(jpegOf(10)).contentType).toBe('image/jpeg');
    expect(() => files.read(jpegOf(11))).toThrow(ImageTooLargeError);
  });
});
