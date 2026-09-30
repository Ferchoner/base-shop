import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MULTER_MODULE_OPTIONS } from '@nestjs/platform-express/multer/files.constants.js';
import { Test } from '@nestjs/testing';
import { ProductImageFiles } from './application/product-image-files.js';
import { ProductImageStorage } from './application/product-image-storage.js';
import { imageUploads, PRODUCT_IMAGE_PROVIDERS } from './catalog.module.js';
import { ImageTooLargeError } from './domain/product-image-file.js';

@Module({ imports: [imageUploads()], providers: PRODUCT_IMAGE_PROVIDERS })
class ProductImagesTestModule {}

/** Looks the provider up in any module of the test, as the module does not export it. */
const anywhere = { strict: false } as const;

/** The product images read their settings from the environment (ADR-0121). */
describe('Product image wiring', () => {
  it('cuts uploads, checks images and builds URLs with the configured values', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              IMAGE_MAX_BYTES: 10,
              IMAGE_STORAGE_DIR: 'storage/test-images',
              IMAGE_BASE_URL: 'https://cdn.example.com/shop',
            }),
          ],
        }),
        ProductImagesTestModule,
      ],
    }).compile();
    const jpegOf = (size: number) => {
      const bytes = new Uint8Array(size);
      bytes.set([0xff, 0xd8, 0xff]);
      return bytes;
    };
    const key =
      'products/01a0ea00-c750-7792-a69b-a7289f1a8f47/01a0ea00-c755-706d-9721-7e4a48b61d77.jpg';

    expect(moduleRef.get(MULTER_MODULE_OPTIONS, anywhere)).toMatchObject({
      limits: { fileSize: 10, files: 1 },
    });
    expect(
      moduleRef.get(ProductImageFiles, anywhere).read(jpegOf(10)).sizeBytes,
    ).toBe(10);
    expect(() =>
      moduleRef.get(ProductImageFiles, anywhere).read(jpegOf(11)),
    ).toThrow(ImageTooLargeError);
    expect(moduleRef.get(ProductImageStorage, anywhere).urlOf(key)).toBe(
      `https://cdn.example.com/shop/${key}`,
    );
    await moduleRef.close();
  });
});
