import { Module } from '@nestjs/common';
import { GeoCatalog } from './application/geo.facade.js';
import { ImportGeoCatalog } from './application/import-geo-catalog.use-case.js';
import { GeoCatalogRepository } from './domain/geo-catalog.repository.js';
import { GeoCatalogImportCommand } from './infrastructure/geo-catalog-import.command.js';
import { PrismaGeoCatalogRepository } from './infrastructure/prisma-geo-catalog.repository.js';
import { GeoCatalogController } from './presentation/geo-catalog.controller.js';

/**
 * Geographic catalog of states and municipalities from INEGI (ADR-0057, T-124): a cross-cutting capability
 * with read-only reference data, not a bounded context (ARCHITECTURE.md).
 */
@Module({
  controllers: [GeoCatalogController],
  providers: [
    GeoCatalog,
    ImportGeoCatalog,
    GeoCatalogImportCommand,
    { provide: GeoCatalogRepository, useClass: PrismaGeoCatalogRepository },
  ],
  exports: [GeoCatalog, GeoCatalogImportCommand],
})
export class GeoModule {}
