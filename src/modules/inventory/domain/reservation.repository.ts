import type { Allocation } from './allocation.js';
import type {
  CommitOutcome,
  OrderId,
  ReservationId,
  ReservationReceipt,
  StockRequest,
} from './reservation.js';
import type { VariantId } from './stock.js';
import type { WarehouseId } from './warehouse.js';

/**
 * `reservations` and `reservation_lines`, with the `stock_items` they hold and the movements of a sale, always
 * through the active transaction (DATABASE.md §6.4, §6.5, §12). Every status change is a conditional atomic
 * update, so it happens once even when two changes race; stock items are updated in ascending ID order
 * (BR-INV-14). An abstract class rather than an interface, so it can be the dependency injection token
 * without depending on NestJS.
 */
export abstract class ReservationRepository {
  /**
   * Opens the active reservation of an order, or answers the one it already has (BR-INV-04): two at the same
   * time open one.
   */
  abstract open(reservation: {
    readonly id: ReservationId;
    readonly orderId: OrderId;
    readonly expiresAt: Date;
    readonly at: Date;
  }): Promise<{ opened: boolean; receipt: ReservationReceipt }>;

  /**
   * Reserves each request in the warehouse, one conditional update per stock item, and records the lines.
   * Answers the variants that do not have enough available units, or no stock item, and every variant when the
   * warehouse is no longer active; the caller rolls back when there is any (BR-INV-02). The warehouse stays
   * active until the transaction ends (ADR-0160).
   */
  abstract reserve(
    reservationId: ReservationId,
    warehouseId: WarehouseId,
    requests: readonly StockRequest[],
    at: Date,
  ): Promise<VariantId[]>;

  /**
   * Confirms the active reservation of the order: `onHand` and `reserved` go down by its units and each line
   * writes a SALE movement (UC-INV-06, BR-INV-06).
   */
  abstract commit(orderId: OrderId, at: Date): Promise<CommitOutcome>;

  /** Frees the active reservation of the order (UC-INV-07); `false` when it has none. */
  abstract release(orderId: OrderId, at: Date): Promise<boolean>;

  /**
   * Ends the active reservation of an order that was not paid in time, freeing its units like `release`
   * (UC-INV-08); `false` when it has none.
   */
  abstract expire(orderId: OrderId, at: Date): Promise<boolean>;

  /** Whether the stock of the order was confirmed: it has a COMMITTED reservation, so its units left (UC-INV-06). */
  abstract isCommitted(orderId: OrderId): Promise<boolean>;

  /**
   * The warehouses the confirmed stock of the order left from, with the units of each variant (ADR-0160): a group
   * per warehouse, by priority and then code. None when its stock was not confirmed.
   */
  abstract allocationOf(orderId: OrderId): Promise<Allocation[]>;
}
