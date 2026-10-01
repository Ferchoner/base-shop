import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/index.js';
import { GeoModule } from '../geo/index.js';
import { CatalogVariants } from './application/catalog-variants.js';
import { InventoryQueries } from './application/inventory.queries.js';
import { StockEntries } from './application/stock-entries.use-case.js';
import { StockListing } from './application/stock-listing.js';
import { UpdateWarehouse } from './application/update-warehouse.use-case.js';
import { WarehouseLocations } from './application/warehouse-locations.js';
import { StockLedgerRepository } from './domain/stock-ledger.repository.js';
import { WarehouseRepository } from './domain/warehouse.repository.js';
import { CatalogFacadeVariants } from './infrastructure/catalog-facade-variants.js';
import { GeoWarehouseLocations } from './infrastructure/geo-warehouse-locations.js';
import { PrismaInventoryQueries } from './infrastructure/prisma-inventory.queries.js';
import { PrismaStockLedgerRepository } from './infrastructure/prisma-stock-ledger.repository.js';
import { PrismaWarehouseRepository } from './infrastructure/prisma-warehouse.repository.js';
import { AdminStockController } from './presentation/admin-stock.controller.js';
import { AdminWarehousesController } from './presentation/admin-warehouses.controller.js';

/**
 * Inventory bounded context (ADR-0004). Wires its layers; see docs/ARCHITECTURE.md. It uses Catalog and Geo
 * through their facades, and neither uses Inventory, so they never form a cycle (ADR-0127).
 */
@Module({
  imports: [CatalogModule, GeoModule],
  controllers: [AdminWarehousesController, AdminStockController],
  providers: [
    UpdateWarehouse,
    StockEntries,
    StockListing,
    { provide: WarehouseRepository, useClass: PrismaWarehouseRepository },
    { provide: StockLedgerRepository, useClass: PrismaStockLedgerRepository },
    { provide: InventoryQueries, useClass: PrismaInventoryQueries },
    { provide: CatalogVariants, useClass: CatalogFacadeVariants },
    { provide: WarehouseLocations, useClass: GeoWarehouseLocations },
  ],
})
export class InventoryModule {}
