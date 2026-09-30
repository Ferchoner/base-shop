import {
  Controller,
  Delete,
  HttpCode,
  Module,
  Param,
  Post,
  Query,
  UploadedFile,
} from '@nestjs/common';
import { ProductImageFiles } from '../../src/modules/catalog/application/product-image-files.js';
import { ProductImageStorage } from '../../src/modules/catalog/application/product-image-storage.js';
import {
  imageUploads,
  PRODUCT_IMAGE_PROVIDERS,
} from '../../src/modules/catalog/catalog.module.js';
import type { ProductId } from '../../src/modules/catalog/domain/product-id.js';
import { newProductImageKey } from '../../src/modules/catalog/domain/product-image-file.js';
import {
  ImageUpload,
  requireImage,
  type UploadedImage,
} from '../../src/modules/catalog/presentation/image-upload.js';

/**
 * Exists only in the tests of T-141: receives and stores an image as the endpoints of T-140 will, with the
 * same upload limits, check and storage of the Catalog module.
 */
@Controller('image-upload-sample')
export class ImageUploadSampleController {
  constructor(
    private readonly files: ProductImageFiles,
    private readonly storage: ProductImageStorage,
  ) {}

  @ImageUpload()
  @Post(':productId')
  async upload(
    @Param('productId') productId: string,
    @UploadedFile() image: UploadedImage | undefined,
  ) {
    const file = this.files.read(requireImage(image).buffer);
    const key = newProductImageKey(productId as ProductId, file);
    await this.storage.save(key, file);
    return {
      key,
      url: this.storage.urlOf(key),
      contentType: file.contentType,
      sizeBytes: file.sizeBytes,
    };
  }

  @HttpCode(204)
  @Delete()
  async remove(@Query('key') key: string): Promise<void> {
    await this.storage.delete(key);
  }
}

@Module({
  imports: [imageUploads()],
  controllers: [ImageUploadSampleController],
  providers: PRODUCT_IMAGE_PROVIDERS,
})
export class ImageUploadSampleModule {}
