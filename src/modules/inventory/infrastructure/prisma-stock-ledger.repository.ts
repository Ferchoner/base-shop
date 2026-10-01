import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import { newId, toId } from '../../../shared-kernel/index.js';
import type {
  AdjustmentReason,
  StockLevel,
  StockMovementType,
} from '../domain/stock.js';
import {
  type StockChange,
  type StockEntry,
  StockLedgerRepository,
} from '../domain/stock-ledger.repository.js';

interface StockRow {
  id: string;
  variant_id: string;
  warehouse_id: string;
  on_hand: number;
  reserved: number;
  updated_at: Date;
}

/**
 * `stock_items` and `stock_movements` (DATABASE.md §6.2, §6.3), always through the active transaction. Each
 * change is one conditional atomic `UPDATE … RETURNING`: concurrent changes of one stock item wait for each
 * other on its row, and the `CHECK` of the table backs the condition (DATABASE.md §12).
 */
@Injectable()
export class PrismaStockLedgerRepository extends StockLedgerRepository {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  async receive(entry: StockEntry): Promise<StockChange> {
    const stock = await this.change(entry, false);
    if (stock === null) throw new Error('A receipt always applies');
    return this.record(stock, entry, 'RECEIPT', null);
  }

  async adjust(
    entry: StockEntry & { readonly reasonCode: AdjustmentReason },
  ): Promise<StockChange | null> {
    const stock = await this.change(entry, true);
    return stock === null
      ? null
      : this.record(stock, entry, 'ADJUSTMENT', entry.reasonCode);
  }

  /**
   * Adds the signed quantity to `onHand`, creating the stock item if needed. With `guarded`, only when
   * `onHand` stays at or above `reserved`, which is never below zero; `null` otherwise.
   */
  private async change(
    entry: StockEntry,
    guarded: boolean,
  ): Promise<StockLevel | null> {
    const tx = this.txHost.tx;
    // A first receipt of the variant creates its stock item; two at the same time create it once.
    await tx.$executeRaw`
      INSERT INTO stock_items (id, variant_id, warehouse_id, on_hand, reserved, created_at, updated_at)
      VALUES (${newId<'StockItem'>()}::uuid, ${entry.variantId}::uuid, ${entry.warehouseId}::uuid, 0, 0,
              ${entry.at}, ${entry.at})
      ON CONFLICT (variant_id, warehouse_id) DO NOTHING`;
    const rows = guarded
      ? await tx.$queryRaw<StockRow[]>`
          UPDATE stock_items
             SET on_hand = on_hand + ${entry.quantity}::int, updated_at = ${entry.at}
           WHERE variant_id = ${entry.variantId}::uuid AND warehouse_id = ${entry.warehouseId}::uuid
             AND on_hand + ${entry.quantity}::int >= reserved
       RETURNING id, variant_id, warehouse_id, on_hand, reserved, updated_at`
      : await tx.$queryRaw<StockRow[]>`
          UPDATE stock_items
             SET on_hand = on_hand + ${entry.quantity}::int, updated_at = ${entry.at}
           WHERE variant_id = ${entry.variantId}::uuid AND warehouse_id = ${entry.warehouseId}::uuid
       RETURNING id, variant_id, warehouse_id, on_hand, reserved, updated_at`;
    const [row] = rows;
    return row === undefined
      ? null
      : {
          id: toId<'StockItem'>(row.id),
          variantId: toId<'Variant'>(row.variant_id),
          warehouseId: toId<'Warehouse'>(row.warehouse_id),
          onHand: row.on_hand,
          reserved: row.reserved,
          updatedAt: row.updated_at,
        };
  }

  /** The movement of a change, in the same transaction (BR-INV-13). */
  private async record(
    stock: StockLevel,
    entry: StockEntry,
    type: StockMovementType,
    reasonCode: AdjustmentReason | null,
  ): Promise<StockChange> {
    await this.txHost.tx.stockMovement.create({
      data: {
        id: entry.movementId,
        stockItemId: stock.id,
        type,
        quantity: entry.quantity,
        onHandAfter: stock.onHand,
        reasonCode,
        note: entry.note,
        actorId: entry.actorId,
        createdAt: entry.at,
      },
    });
    return {
      stock,
      movement: {
        id: entry.movementId,
        stockItemId: stock.id,
        type,
        quantity: entry.quantity,
        onHandAfter: stock.onHand,
        reasonCode,
        note: entry.note,
        orderId: null,
        orderLineId: null,
        actorId: entry.actorId,
        createdAt: entry.at,
      },
    };
  }
}
