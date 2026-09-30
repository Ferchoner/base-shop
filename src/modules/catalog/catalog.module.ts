import { Module } from '@nestjs/common';
import { CatalogQueries } from './application/catalog.queries.js';
import { ChangeBrandStatus } from './application/change-brand-status.use-case.js';
import { CreateBrand } from './application/create-brand.use-case.js';
import { CreateCategory } from './application/create-category.use-case.js';
import { DeactivateCategory } from './application/deactivate-category.use-case.js';
import { DeleteBrand } from './application/delete-brand.use-case.js';
import { DeleteCategory } from './application/delete-category.use-case.js';
import { ReactivateCategory } from './application/reactivate-category.use-case.js';
import { UpdateBrand } from './application/update-brand.use-case.js';
import { UpdateCategory } from './application/update-category.use-case.js';
import { BrandRepository } from './domain/brand.repository.js';
import { CategoryRepository } from './domain/category.repository.js';
import { PrismaBrandRepository } from './infrastructure/prisma-brand.repository.js';
import { PrismaCatalogQueries } from './infrastructure/prisma-catalog.queries.js';
import { PrismaCategoryRepository } from './infrastructure/prisma-category.repository.js';
import { PublicCatalogCacheInvalidation } from './infrastructure/public-catalog-cache.event-handler.js';
import { AdminBrandsController } from './presentation/admin-brands.controller.js';
import { AdminCategoriesController } from './presentation/admin-categories.controller.js';
import { CatalogController } from './presentation/catalog.controller.js';

/** Catalog bounded context (ADR-0004). Wires its layers; see docs/ARCHITECTURE.md. */
@Module({
  controllers: [
    CatalogController,
    AdminCategoriesController,
    AdminBrandsController,
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
    { provide: CategoryRepository, useClass: PrismaCategoryRepository },
    { provide: BrandRepository, useClass: PrismaBrandRepository },
    { provide: CatalogQueries, useClass: PrismaCatalogQueries },
  ],
})
export class CatalogModule {}
