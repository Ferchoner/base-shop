import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/index.js';
import { CreatePromotion } from './application/create-promotion.use-case.js';
import { EndPromotion } from './application/end-promotion.use-case.js';
import { PromotionCatalog } from './application/promotion-ports.js';
import { PromotionReader } from './application/promotion-reader.js';
import { PromotionsFacade } from './application/promotions.facade.js';
import { PromotionQueries } from './application/promotions.queries.js';
import { UpdatePromotion } from './application/update-promotion.use-case.js';
import { PromotionRepository } from './domain/promotion.repository.js';
import { CatalogFacadePromotionCatalog } from './infrastructure/facade-adapters.js';
import { PrismaPromotionRepository } from './infrastructure/prisma-promotion.repository.js';
import { PrismaPromotionQueries } from './infrastructure/prisma-promotions.queries.js';
import { AdminPromotionsController } from './presentation/admin-promotions.controller.js';

/**
 * Promotions (ADR-0168): a percentage or an amount off the whole purchase or certain products, categories or brands.
 * It reads the products, categories and brands it targets from Catalog, through its facade (ADR-0005); Catalog does
 * not use Promotions. Its own facade gives Ordering the discount of each quote and order (T-200 part b).
 */
@Module({
  imports: [CatalogModule],
  controllers: [AdminPromotionsController],
  providers: [
    CreatePromotion,
    UpdatePromotion,
    EndPromotion,
    PromotionReader,
    PromotionsFacade,
    { provide: PromotionRepository, useClass: PrismaPromotionRepository },
    { provide: PromotionQueries, useClass: PrismaPromotionQueries },
    { provide: PromotionCatalog, useClass: CatalogFacadePromotionCatalog },
  ],
  exports: [PromotionsFacade],
})
export class PromotionsModule {}
