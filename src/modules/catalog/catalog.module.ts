import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import type { EnvironmentVariables } from '../../platform/config/environment.js';
import { CatalogQueries } from './application/catalog.queries.js';
import { ChangeBrandStatus } from './application/change-brand-status.use-case.js';
import { CreateBrand } from './application/create-brand.use-case.js';
import { CreateCategory } from './application/create-category.use-case.js';
import { CreateProduct } from './application/create-product.use-case.js';
import { DeactivateCategory } from './application/deactivate-category.use-case.js';
import { DeleteBrand } from './application/delete-brand.use-case.js';
import { DeleteCategory } from './application/delete-category.use-case.js';
import {
  IMAGE_MAX_BYTES,
  ProductImageFiles,
} from './application/product-image-files.js';
import { ProductImageStorage } from './application/product-image-storage.js';
import { ProductLifecycle } from './application/product-lifecycle.use-case.js';
import { ProductSearchIndex } from './application/product-search-index.js';
import { ProductVariants } from './application/product-variants.use-case.js';
import { ReactivateCategory } from './application/reactivate-category.use-case.js';
import { UpdateBrand } from './application/update-brand.use-case.js';
import { UpdateCategory } from './application/update-category.use-case.js';
import { UpdateProduct } from './application/update-product.use-case.js';
import { BrandRepository } from './domain/brand.repository.js';
import { CategoryRepository } from './domain/category.repository.js';
import { ProductRepository } from './domain/product.repository.js';
import {
  IMAGE_STORAGE_SETTINGS,
  type ImageStorageSettings,
  LocalDiskProductImageStorage,
} from './infrastructure/local-disk-product-image-storage.js';
import { PrismaBrandRepository } from './infrastructure/prisma-brand.repository.js';
import { PrismaCatalogQueries } from './infrastructure/prisma-catalog.queries.js';
import { PrismaCategoryRepository } from './infrastructure/prisma-category.repository.js';
import { PrismaProductSearchIndex } from './infrastructure/prisma-product-search-index.js';
import { PrismaProductRepository } from './infrastructure/prisma-product.repository.js';
import { PublicCatalogCacheInvalidation } from './infrastructure/public-catalog-cache.event-handler.js';
import { AdminBrandsController } from './presentation/admin-brands.controller.js';
import { AdminCategoriesController } from './presentation/admin-categories.controller.js';
import { AdminProductsController } from './presentation/admin-products.controller.js';
import { CatalogController } from './presentation/catalog.controller.js';
import { imageUploadOptions } from './presentation/image-upload.js';

type Config = ConfigService<EnvironmentVariables, true>;

/** Product images (ADR-0024, ADR-0121): the configured limit, its check and the disk storage. */
export const PRODUCT_IMAGE_PROVIDERS: Provider[] = [
  {
    provide: IMAGE_MAX_BYTES,
    inject: [ConfigService],
    useFactory: (config: Config) =>
      config.get('IMAGE_MAX_BYTES', { infer: true }),
  },
  {
    provide: IMAGE_STORAGE_SETTINGS,
    inject: [ConfigService],
    useFactory: (config: Config): ImageStorageSettings => ({
      directory: config.get('IMAGE_STORAGE_DIR', { infer: true }),
      baseUrl: config.get('IMAGE_BASE_URL', { infer: true }),
    }),
  },
  ProductImageFiles,
  { provide: ProductImageStorage, useClass: LocalDiskProductImageStorage },
];

/** Multer for the image uploads of this module, cut at `IMAGE_MAX_BYTES` (ADR-0121). */
export function imageUploads(): DynamicModule {
  return MulterModule.registerAsync({
    inject: [ConfigService],
    useFactory: (config: Config) =>
      imageUploadOptions(config.get('IMAGE_MAX_BYTES', { infer: true })),
  });
}

/** Catalog bounded context (ADR-0004). Wires its layers; see docs/ARCHITECTURE.md. */
@Module({
  imports: [imageUploads()],
  controllers: [
    CatalogController,
    AdminCategoriesController,
    AdminBrandsController,
    AdminProductsController,
  ],
  providers: [
    PublicCatalogCacheInvalidation,
    CreateCategory,
    UpdateCategory,
    DeactivateCategory,
    ReactivateCategory,
    DeleteCategory,
    CreateBrand,
    UpdateBrand,
    ChangeBrandStatus,
    DeleteBrand,
    CreateProduct,
    UpdateProduct,
    ProductLifecycle,
    ProductVariants,
    { provide: CategoryRepository, useClass: PrismaCategoryRepository },
    { provide: BrandRepository, useClass: PrismaBrandRepository },
    { provide: ProductRepository, useClass: PrismaProductRepository },
    { provide: ProductSearchIndex, useClass: PrismaProductSearchIndex },
    { provide: CatalogQueries, useClass: PrismaCatalogQueries },
    ...PRODUCT_IMAGE_PROVIDERS,
  ],
})
export class CatalogModule {}
