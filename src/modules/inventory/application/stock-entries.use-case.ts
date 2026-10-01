import { Injectable } from '@nestjs/common';
import {
  AuditTrail,
  changesBetween,
  Clock,
  newId,
  NotFoundError,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import {
  type AdjustmentReason,
  checkAdjustment,
  InsufficientStockError,
  noteOf,
  receiptQuantity,
  type StockMovement,
  type VariantId,
} from '../domain/stock.js';
import {
  type StockChange,
  StockLedgerRepository,
} from '../domain/stock-ledger.repository.js';
import type { WarehouseId } from '../domain/warehouse.js';
import { WarehouseRepository } from '../domain/warehouse.repository.js';
import { CatalogVariants } from './catalog-variants.js';
import { type StockItemView, stockItemView } from './stock-listing.js';

/** A receipt or adjustment as the API answers it: the stock after it and its movement. */
export interface StockEntryView {
  readonly stockItem: StockItemView;
  readonly movement: StockMovement;
}

interface Entry {
  readonly variantId: VariantId;
  readonly warehouseId: WarehouseId;
  readonly quantity: number;
  readonly note?: string | null;
}

/**
 * Receipts (UC-INV-02) and adjustments (UC-INV-03) of the staff, ADR-0069 and ADR-0127. The variant must exist
 * in Catalog, in any status, and the warehouse must be the active one. Each one changes `onHand` with one
 * conditional atomic update, writes its movement and is audited, all in one transaction.
 */
@Injectable()
export class StockEntries {
  constructor(
    private readonly ledger: StockLedgerRepository,
    private readonly warehouses: WarehouseRepository,
    private readonly variants: CatalogVariants,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  /** Adds units received, creating the stock item on the first receipt of the variant. */
  async receive(entry: Entry, staffId: string): Promise<StockEntryView> {
    const quantity = receiptQuantity(entry.quantity);
    await this.requireVariantAndWarehouse(entry);
    const change = await this.transactions.run(async () => {
      const received = await this.ledger.receive({
        ...this.base(entry, staffId),
        quantity,
      });
      await this.record('inventory.receipt', received);
      return received;
    });
    return this.view(change);
  }

  /**
   * Adds or takes away units with a reason (ADR-0069).
   *
   * @throws InsufficientStockError when it would leave `onHand` below `reserved` or zero (BR-INV-01).
   */
  async adjust(
    entry: Entry & { readonly reasonCode: AdjustmentReason },
    staffId: string,
  ): Promise<StockEntryView> {
    const note = noteOf(entry.note);
    checkAdjustment({
      quantity: entry.quantity,
      reasonCode: entry.reasonCode,
      note,
    });
    await this.requireVariantAndWarehouse(entry);
    const change = await this.transactions.run(async () => {
      const adjusted = await this.ledger.adjust({
        ...this.base(entry, staffId),
        quantity: entry.quantity,
        reasonCode: entry.reasonCode,
      });
      if (adjusted === null) throw new InsufficientStockError(entry.variantId);
      await this.record('inventory.adjustment', adjusted);
      return adjusted;
    });
    return this.view(change);
  }

  private base(entry: Entry, staffId: string) {
    return {
      movementId: newId<'StockMovement'>(),
      warehouseId: entry.warehouseId,
      variantId: entry.variantId,
      note: noteOf(entry.note),
      actorId: staffId,
      at: this.clock.now(),
    };
  }

  private async requireVariantAndWarehouse(entry: Entry): Promise<void> {
    if (!(await this.variants.exists(entry.variantId))) {
      throw new NotFoundError('Variant', entry.variantId);
    }
    const warehouse = await this.warehouses.find(entry.warehouseId);
    // In the MVP only the active warehouse takes stock (ADR-0081); another one is answered as missing.
    if (warehouse === null || !warehouse.isActive) {
      throw new NotFoundError('Warehouse', entry.warehouseId);
    }
  }

  private record(action: string, { stock, movement }: StockChange) {
    return this.audit.record({
      action,
      resource: { type: 'stock-item', id: stock.id },
      changes: changesBetween(
        {},
        {
          variantId: stock.variantId,
          warehouseId: stock.warehouseId,
          quantity: movement.quantity,
          reasonCode: movement.reasonCode,
          note: movement.note,
          onHandAfter: movement.onHandAfter,
        },
      ),
    });
  }

  private async view({
    stock,
    movement,
  }: StockChange): Promise<StockEntryView> {
    const labels = await this.variants.labels([stock.variantId]);
    return { stockItem: stockItemView(stock, labels), movement };
  }
}
