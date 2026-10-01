import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import { newId, toId } from '../../../shared-kernel/index.js';
import type {
  CommitOutcome,
  OrderId,
  ReservationId,
  ReservationReceipt,
  StockRequest,
} from '../domain/reservation.js';
import { ReservationRepository } from '../domain/reservation.repository.js';
import type { VariantId } from '../domain/stock.js';
import type { WarehouseId } from '../domain/warehouse.js';

interface ReservationRow {
  id: string;
  order_id: string;
  expires_at: Date;
}

interface LineRow {
  stock_item_id: string;
  quantity: number;
}

const toReceipt = (row: ReservationRow): ReservationReceipt => ({
  reservationId: toId<'Reservation'>(row.id),
  orderId: toId<'Order'>(row.order_id),
  expiresAt: row.expires_at,
});

/**
 * `reservations` and `reservation_lines` (DATABASE.md §6.4, §6.5) with the stock items they hold, always
 * through the active transaction. Every change is a conditional atomic update (DATABASE.md §12): a
 * reservation leaves ACTIVE once, and a stock item is reserved only while it has the units. Stock items are
 * updated in ascending ID order, so two reservations never wait for each other in a circle (BR-INV-14).
 */
@Injectable()
export class PrismaReservationRepository extends ReservationRepository {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  async open(reservation: {
    readonly id: ReservationId;
    readonly orderId: OrderId;
    readonly expiresAt: Date;
    readonly at: Date;
  }): Promise<{ opened: boolean; receipt: ReservationReceipt }> {
    const tx = this.txHost.tx;
    // The partial unique index keeps one active reservation per order (BR-INV-04): a second one at the same
    // time waits for the first one's commit and inserts nothing.
    const [opened] = await tx.$queryRaw<ReservationRow[]>`
      INSERT INTO reservations (id, order_id, status, expires_at, version, created_at, updated_at)
      VALUES (${reservation.id}::uuid, ${reservation.orderId}::uuid, 'ACTIVE', ${reservation.expiresAt},
              1, ${reservation.at}, ${reservation.at})
      ON CONFLICT (order_id) WHERE status = 'ACTIVE' DO NOTHING
      RETURNING id, order_id, expires_at`;
    if (opened !== undefined)
      return { opened: true, receipt: toReceipt(opened) };
    const [existing] = await tx.$queryRaw<ReservationRow[]>`
      SELECT id, order_id, expires_at FROM reservations
       WHERE order_id = ${reservation.orderId}::uuid AND status = 'ACTIVE'`;
    if (existing === undefined) {
      throw new Error('The active reservation of the order disappeared');
    }
    return { opened: false, receipt: toReceipt(existing) };
  }

  async reserve(
    reservationId: ReservationId,
    warehouseId: WarehouseId,
    requests: readonly StockRequest[],
    at: Date,
  ): Promise<VariantId[]> {
    const tx = this.txHost.tx;
    const wanted = new Map(
      requests.map(({ variantId, quantity }) => [variantId, quantity]),
    );
    const items = await tx.$queryRaw<{ id: string; variant_id: string }[]>`
      SELECT id, variant_id FROM stock_items
       WHERE warehouse_id = ${warehouseId}::uuid AND variant_id = ANY(${[...wanted.keys()]}::uuid[])
       ORDER BY id`;
    const reserved: LineRow[] = [];
    const short = new Set<string>(wanted.keys());
    for (const item of items) {
      const quantity = wanted.get(toId<'Variant'>(item.variant_id)) ?? 0;
      const updated = await tx.$executeRaw`
        UPDATE stock_items
           SET reserved = reserved + ${quantity}::int, updated_at = ${at}
         WHERE id = ${item.id}::uuid AND on_hand - reserved >= ${quantity}::int`;
      if (updated === 1) {
        short.delete(item.variant_id);
        reserved.push({ stock_item_id: item.id, quantity });
      }
    }
    // Nothing to keep when some line is short: InventoryFacade.reserve undoes the whole step (ADR-0132).
    if (short.size === 0) {
      await tx.reservationLine.createMany({
        data: reserved.map(({ stock_item_id, quantity }) => ({
          reservationId,
          stockItemId: stock_item_id,
          quantity,
        })),
      });
    }
    return requests
      .map(({ variantId }) => variantId)
      .filter((variantId) => short.has(variantId));
  }

  async commit(orderId: OrderId, at: Date): Promise<CommitOutcome> {
    const tx = this.txHost.tx;
    const lines = await this.leave(orderId, 'COMMITTED', at);
    if (lines === null) {
      const committed = await tx.reservation.count({
        where: { orderId, status: 'COMMITTED' },
      });
      return committed > 0 ? 'already-committed' : 'not-active';
    }
    const movements = [];
    for (const { stock_item_id, quantity } of lines) {
      const [item] = await tx.$queryRaw<{ on_hand: number }[]>`
        UPDATE stock_items
           SET on_hand = on_hand - ${quantity}::int, reserved = reserved - ${quantity}::int, updated_at = ${at}
         WHERE id = ${stock_item_id}::uuid
     RETURNING on_hand`;
      movements.push({
        id: newId<'StockMovement'>(),
        stockItemId: stock_item_id,
        type: 'SALE' as const,
        quantity: -quantity,
        onHandAfter: item.on_hand,
        orderId,
        createdAt: at,
      });
    }
    // The ledger of each stock item records its sale (BR-INV-13).
    await tx.stockMovement.createMany({ data: movements });
    return 'committed';
  }

  async release(orderId: OrderId, at: Date): Promise<boolean> {
    const lines = await this.leave(orderId, 'RELEASED', at);
    if (lines === null) return false;
    for (const { stock_item_id, quantity } of lines) {
      await this.txHost.tx.$executeRaw`
        UPDATE stock_items
           SET reserved = reserved - ${quantity}::int, updated_at = ${at}
         WHERE id = ${stock_item_id}::uuid`;
    }
    return true;
  }

  /**
   * Moves the active reservation of the order to `status`, once (BR-INV-03), and answers its lines in
   * ascending order of stock item; `null` when the order has no active reservation.
   */
  private async leave(
    orderId: OrderId,
    status: 'COMMITTED' | 'RELEASED',
    at: Date,
  ): Promise<LineRow[] | null> {
    const tx = this.txHost.tx;
    const [left] = await tx.$queryRaw<{ id: string }[]>`
      UPDATE reservations
         SET status = ${status}::reservation_status, version = version + 1, updated_at = ${at}
       WHERE order_id = ${orderId}::uuid AND status = 'ACTIVE'
   RETURNING id`;
    if (left === undefined) return null;
    return tx.$queryRaw<LineRow[]>`
      SELECT stock_item_id, quantity FROM reservation_lines
       WHERE reservation_id = ${left.id}::uuid
       ORDER BY stock_item_id`;
  }
}
