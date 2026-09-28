import { Module } from '@nestjs/common';
import { PublicCatalogCacheInvalidation } from './infrastructure/public-catalog-cache.event-handler.js';

/** Catalog bounded context (ADR-0004). Wires its layers; see docs/ARCHITECTURE.md. */
@Module({
  providers: [PublicCatalogCacheInvalidation],
})
export class CatalogModule {}
