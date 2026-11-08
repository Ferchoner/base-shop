import { Injectable } from '@nestjs/common';
import {
  AuditTrail,
  changesBetween,
  Clock,
  NotFoundError,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import { locationOf, type VariantId } from '../domain/stock.js';
import { StockLedgerRepository } from '../domain/stock-ledger.repository.js';
import type { WarehouseId } from '../domain/warehouse.js';
import { WarehouseRepository } from '../domain/warehouse.repository.js';
import { CatalogVariants } from './catalog-variants.js';
import { type StockItemView, stockItemView } from './stock-listing.js';

/** Where a variant is in a warehouse; `null` clears it. */
export interface LocationChange {
  readonly variantId: VariantId;
  readonly warehouseId: WarehouseId;
  readonly location: string | null;
}

/**
 * The location of each product in each warehouse (UC-INV-17, ADR-0173). The variant must exist in Catalog, in
 * any status, and the warehouse may be inactive, like an adjustment. A location is set before the first units
 * arrive, so it creates the stock item with none. A transfer never changes it. Audited as `inventory.location`
 * when it changes.
 */
@Injectable()
export class StockLocations {
  constructor(
    private readonly ledger: StockLedgerRepository,
    private readonly warehouses: WarehouseRepository,
    private readonly variants: CatalogVariants,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  /**
   * Sets or clears the location.
   *
   * @throws InvalidLocationError when it is blank or longer than 20 characters.
   * @throws NotFoundError for a missing variant or warehouse, or when clearing one that has no stock item.
   */
  async set(change: LocationChange): Promise<StockItemView> {
    const location = locationOf(change.location);
    if (!(await this.variants.exists(change.variantId))) {
      throw new NotFoundError('Variant', change.variantId);
    }
    const stock = await this.transactions.run(async () => {
      if ((await this.warehouses.find(change.warehouseId)) === null) {
        throw new NotFoundError('Warehouse', change.warehouseId);
      }
      const set = await this.ledger.setLocation(
        { variantId: change.variantId, warehouseId: change.warehouseId },
        location,
        this.clock.now(),
      );
      if (set === null) {
        throw new NotFoundError(
          'StockItem',
          `${change.variantId}/${change.warehouseId}`,
        );
      }
      if (set.before !== location) {
        await this.audit.record({
          action: 'inventory.location',
          resource: { type: 'stock-item', id: set.stock.id },
          changes: changesBetween({ location: set.before }, { location }),
        });
      }
      return set.stock;
    });
    const labels = await this.variants.labels([stock.variantId]);
    return stockItemView(stock, labels);
  }
}
