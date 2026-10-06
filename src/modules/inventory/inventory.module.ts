import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseDuration } from '../../platform/config/duration.js';
import type { EnvironmentVariables } from '../../platform/config/environment.js';
import { CatalogModule } from '../catalog/index.js';
import { GeoModule } from '../geo/index.js';
import { CatalogVariants } from './application/catalog-variants.js';
import { CreateWarehouse } from './application/create-warehouse.use-case.js';
import { DeactivateWarehouse } from './application/deactivate-warehouse.use-case.js';
import {
  InventoryFacade,
  RESERVATION_TTL_SECONDS,
} from './application/inventory.facade.js';
import { InventoryQueries } from './application/inventory.queries.js';
import { StockEntries } from './application/stock-entries.use-case.js';
import { StockListing } from './application/stock-listing.js';
import { UpdateWarehouse } from './application/update-warehouse.use-case.js';
import { WarehouseLocations } from './application/warehouse-locations.js';
import { ReservationRepository } from './domain/reservation.repository.js';
import { StockLedgerRepository } from './domain/stock-ledger.repository.js';
import { WarehouseRepository } from './domain/warehouse.repository.js';
import { CatalogFacadeVariants } from './infrastructure/catalog-facade-variants.js';
import { GeoWarehouseLocations } from './infrastructure/geo-warehouse-locations.js';
import { PrismaInventoryQueries } from './infrastructure/prisma-inventory.queries.js';
import { PrismaReservationRepository } from './infrastructure/prisma-reservation.repository.js';
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
    {
      provide: RESERVATION_TTL_SECONDS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        parseDuration(config.get('RESERVATION_TTL', { infer: true })),
    },
    InventoryFacade,
    CreateWarehouse,
    UpdateWarehouse,
    DeactivateWarehouse,
    StockEntries,
    StockListing,
    { provide: WarehouseRepository, useClass: PrismaWarehouseRepository },
    { provide: StockLedgerRepository, useClass: PrismaStockLedgerRepository },
    { provide: ReservationRepository, useClass: PrismaReservationRepository },
    { provide: InventoryQueries, useClass: PrismaInventoryQueries },
    { provide: CatalogVariants, useClass: CatalogFacadeVariants },
    { provide: WarehouseLocations, useClass: GeoWarehouseLocations },
  ],
  exports: [InventoryFacade],
})
export class InventoryModule {}
