import { Inject, Injectable } from '@nestjs/common';
import {
  Clock,
  InvalidValueError,
  newId,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import {
  type CommitOutcome,
  mergedRequests,
  type OrderId,
  type ReservationReceipt,
  type StockRequest,
} from '../domain/reservation.js';
import { ReservationRepository } from '../domain/reservation.repository.js';
import {
  InsufficientStockError,
  noteOf,
  type RestockReason,
  RestockLimitError,
  type StockMovement,
  type VariantId,
} from '../domain/stock.js';
import { StockLedgerRepository } from '../domain/stock-ledger.repository.js';
import type { Warehouse, WarehouseId } from '../domain/warehouse.js';
import { WarehouseRepository } from '../domain/warehouse.repository.js';
import { InventoryQueries } from './inventory.queries.js';

export type {
  CommitOutcome,
  OrderId,
  ReservationReceipt,
  StockRequest,
} from '../domain/reservation.js';

export type { RestockReason, StockMovement } from '../domain/stock.js';

/** A line of an order to restock: its variant, the units it sold and those that come back now (UC-INV-09). */
export interface RestockLine {
  readonly orderLineId: string;
  readonly variantId: VariantId;
  /** The quantity of the line; it counts only once the stock of its order was confirmed. */
  readonly sold: number;
  readonly quantity: number;
}

/** Seconds a reservation holds the stock (`RESERVATION_TTL`, BR-INV-07). */
export const RESERVATION_TTL_SECONDS = Symbol('RESERVATION_TTL_SECONDS');

/**
 * Public API of Inventory (ADR-0005, ADR-0128) for the cart (T-170) and the checkout and payments of Ordering
 * (T-180, T-190). Every operation joins the transaction of its caller, so the checkout reserves, creates the
 * order and marks the cart all at once (ADR-0019). Quantities never leave Inventory: the cart and the quote
 * learn only whether each line can be fulfilled (ADR-0061). Reservations are system operations, so they are
 * not audited; the reservations and the SALE movements, with their order, are the record.
 */
@Injectable()
export class InventoryFacade {
  constructor(
    private readonly reservations: ReservationRepository,
    private readonly ledger: StockLedgerRepository,
    private readonly warehouses: WarehouseRepository,
    private readonly queries: InventoryQueries,
    private readonly transactions: TransactionManager,
    private readonly clock: Clock,
    @Inject(RESERVATION_TTL_SECONDS) private readonly ttlSeconds: number,
  ) {}

  /**
   * Whether the active warehouse can fulfill the units asked for each variant now, with the requests of one
   * variant added up. A variant that never had stock cannot.
   *
   * @throws InvalidValueError when a quantity is not a whole number above zero.
   */
  async canFulfill(
    requests: readonly StockRequest[],
  ): Promise<ReadonlyMap<VariantId, boolean>> {
    const merged = mergedRequests(requests);
    if (merged.length === 0) return new Map();
    const warehouse = await this.activeWarehouse();
    const available = await this.queries.availableUnits(
      warehouse.id,
      merged.map(({ variantId }) => variantId),
    );
    return new Map(
      merged.map(({ variantId, quantity }) => [
        variantId,
        (available.get(variantId) ?? 0) >= quantity,
      ]),
    );
  }

  /**
   * Reserves the units of an order until the TTL passes (UC-INV-05): all or nothing (BR-INV-02), and at most
   * one active reservation per order (BR-INV-04), so asking again answers the one it has. It is all or nothing
   * on its own, also inside the transaction of its caller: when a line is short, it undoes what it reserved
   * and the caller's transaction goes on (ADR-0132).
   *
   * @throws InsufficientStockError with every variant that cannot be fulfilled.
   * @throws InvalidValueError for no requests, or a quantity that is not a whole number above zero.
   */
  async reserve(
    orderId: OrderId,
    requests: readonly StockRequest[],
  ): Promise<ReservationReceipt> {
    const merged = mergedRequests(requests);
    if (merged.length === 0) {
      throw new InvalidValueError('A reservation needs at least one line');
    }
    return this.transactions.runNested(async () => {
      const warehouse = await this.activeWarehouse();
      const at = this.clock.now();
      const { opened, receipt } = await this.reservations.open({
        id: newId<'Reservation'>(),
        orderId,
        expiresAt: new Date(at.getTime() + this.ttlSeconds * 1_000),
        at,
      });
      if (!opened) return receipt;
      const missing = await this.reservations.reserve(
        receipt.reservationId,
        warehouse.id,
        merged,
        at,
      );
      if (missing.length > 0) throw new InsufficientStockError(missing);
      return receipt;
    });
  }

  /**
   * Confirms the reservation of a paid order (UC-INV-06): its units leave the stock. A reservation stays valid
   * while it is active, also after `expiresAt` until the expiration job ends it (ADR-0128).
   */
  commit(orderId: OrderId): Promise<CommitOutcome> {
    return this.transactions.run(() =>
      this.reservations.commit(orderId, this.clock.now()),
    );
  }

  /** Frees the reservation of an order (UC-INV-07, BR-INV-09); `false` when it has no active one. */
  release(orderId: OrderId): Promise<boolean> {
    return this.transactions.run(() =>
      this.reservations.release(orderId, this.clock.now()),
    );
  }

  /**
   * Ends the reservation of an order that was not paid in time (UC-INV-08, ADR-0136): EXPIRED, and its units
   * are available again. Ordering decides when, because the order expires with it. `false` when it has no
   * active one, so repeating it changes nothing.
   */
  expire(orderId: OrderId): Promise<boolean> {
    return this.transactions.run(() =>
      this.reservations.expire(orderId, this.clock.now()),
    );
  }

  /**
   * Brings units of lines of an order back to the stock (UC-INV-09, ADR-0052, ADR-0132, ADR-0142). Ordering
   * names each line with its variant and the units it sold, because Inventory never reads orders. A line sold
   * only if the stock of its order was confirmed, and the restocks of a line, added up, never pass what it sold.
   * Each line writes a RESTOCK movement in the active warehouse with its reason, order, line, note and who did it.
   * It joins the transaction of its caller, which locks the order, so restocks of one order wait for each other.
   *
   * @throws RestockLimitError with every line that would bring back more than it sold.
   * @throws InvalidValueError without lines, with a line twice, or with a quantity that is not a whole number
   *   above zero.
   */
  async restock(input: {
    orderId: OrderId;
    reasonCode: RestockReason;
    note: string | null;
    actorId: string;
    lines: readonly RestockLine[];
  }): Promise<StockMovement[]> {
    const lineIds = input.lines.map(({ orderLineId }) => orderLineId);
    if (lineIds.length === 0) {
      throw new InvalidValueError('A restock needs at least one line');
    }
    if (new Set(lineIds).size !== lineIds.length) {
      throw new InvalidValueError('A restock names each line once');
    }
    for (const { quantity } of input.lines) {
      if (!Number.isInteger(quantity) || quantity < 1) {
        throw new InvalidValueError(
          'A restock brings back a whole number of units above zero',
        );
      }
    }
    return this.transactions.run(async () => {
      const committed = await this.reservations.isCommitted(input.orderId);
      const restocked = await this.ledger.restockedOf(lineIds);
      const beyond = input.lines
        .map((line) => ({
          orderLineId: line.orderLineId,
          sold: committed ? line.sold : 0,
          restocked: restocked.get(line.orderLineId) ?? 0,
          requested: line.quantity,
        }))
        .filter((line) => line.restocked + line.requested > line.sold);
      if (beyond.length > 0) throw new RestockLimitError(beyond);
      const warehouse = await this.activeWarehouse();
      const at = this.clock.now();
      const note = noteOf(input.note);
      return this.ledger.restock(
        input.lines.map((line) => ({
          movementId: newId<'StockMovement'>(),
          warehouseId: warehouse.id,
          variantId: line.variantId,
          quantity: line.quantity,
          note,
          actorId: input.actorId,
          at,
          reasonCode: input.reasonCode,
          orderId: input.orderId,
          orderLineId: line.orderLineId,
        })),
      );
    });
  }

  /** The warehouse every order is shipped from: the only active one in the MVP (BR-INV-08, ADR-0140). */
  async activeWarehouseId(): Promise<WarehouseId> {
    return (await this.activeWarehouse()).id;
  }

  private async activeWarehouse(): Promise<Warehouse> {
    const warehouse = await this.warehouses.findActive();
    // A migration creates it (ADR-0127), and nothing deactivates it in the MVP (ADR-0081).
    if (warehouse === null) throw new Error('There is no active warehouse');
    return warehouse;
  }
}
