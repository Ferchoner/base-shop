import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/index.js';
import { CatalogVariants } from './application/catalog-variants.js';
import { PricingFacade } from './application/pricing.facade.js';
import { PricingQueries } from './application/pricing.queries.js';
import { VariantPrices } from './application/variant-prices.use-case.js';
import { PriceListRepository } from './domain/price-list.repository.js';
import { VariantPriceRepository } from './domain/variant-price.repository.js';
import { CatalogFacadeVariants } from './infrastructure/catalog-facade-variants.js';
import { PrismaPriceListRepository } from './infrastructure/prisma-price-list.repository.js';
import { PrismaPricingQueries } from './infrastructure/prisma-pricing.queries.js';
import { PrismaVariantPriceRepository } from './infrastructure/prisma-variant-price.repository.js';
import { AdminPricingController } from './presentation/admin-pricing.controller.js';

/**
 * Pricing bounded context (ADR-0004). Wires its layers; see docs/ARCHITECTURE.md. It uses Catalog through its
 * facade, and Catalog never uses Pricing's, so the two never form a cycle (ADR-0125).
 */
@Module({
  imports: [CatalogModule],
  controllers: [AdminPricingController],
  providers: [
    PricingFacade,
    VariantPrices,
    { provide: PriceListRepository, useClass: PrismaPriceListRepository },
    { provide: VariantPriceRepository, useClass: PrismaVariantPriceRepository },
    { provide: PricingQueries, useClass: PrismaPricingQueries },
    { provide: CatalogVariants, useClass: CatalogFacadeVariants },
  ],
  exports: [PricingFacade],
})
export class PricingModule {}
