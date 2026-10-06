import { Inject, Injectable } from '@nestjs/common';
import {
  Clock,
  InvalidValueError,
  newId,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import {
  type Allocation,
  fulfillableAlone,
  ONE_WAREHOUSE_PER_ORDER,
  shortInClosest,
} from '../domain/allocation.js';
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
import { WarehouseRepository } from '../domain/warehouse.repository.js';
import { InventoryQueries } from './inventory.queries.js';

export type { Allocation } from '../domain/allocation.js';
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
 * not audited; the reservations and the SALE movements, with their order, are the record. Each order is reserved
 * in one warehouse, the first by priority that holds all of it (ADR-0160).
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
   * Whether some active warehouse alone can fulfill the units asked for each variant now, with the requests of
   * one variant added up: each line on its own, as the cart shows it (BR-INV-12). A variant that never had stock
   * cannot.
   *
   * @throws InvalidValueError when a quantity is not a whole number above zero.
   */
  async canFulfill(
    requests: readonly StockRequest[],
  ): Promise<ReadonlyMap<VariantId, boolean>> {
    const merged = mergedRequests(requests);
    if (merged.length === 0) return new Map();
    return fulfillableAlone(await this.stockOf(merged), merged);
  }

  /**
   * Whether each variant can be fulfilled together with the others, as the order of all of them would be
   * reserved (ADR-0160): the variants the closest warehouse leaves out cannot, and they are the ones a
   * reservation would answer as short. Every variant can when one warehouse holds all of them.
   *
   * @throws InvalidValueError when a quantity is not a whole number above zero.
   */
  async canFulfillTogether(
    requests: readonly StockRequest[],
  ): Promise<ReadonlyMap<VariantId, boolean>> {
    const merged = mergedRequests(requests);
    if (merged.length === 0) return new Map();
    const short = shortInClosest(await this.stockOf(merged), merged);
    return new Map(
      merged.map(({ variantId }) => [variantId, !short.includes(variantId)]),
    );
  }

  /**
   * Reserves the units of an order until the TTL passes (UC-INV-05): all or nothing (BR-INV-02), and at most
   * one active reservation per order (BR-INV-04), so asking again answers the one it has. It is all or nothing
   * on its own, also inside the transaction of its caller: when a line is short, it undoes what it reserved
   * and the caller's transaction goes on (ADR-0132). Every unit comes from one warehouse: the first active one
   * by priority that holds all of them, trying the next one when another order took the units first (ADR-0160).
   *
   * @throws InsufficientStockError with the variants the closest warehouse leaves out (ADR-0160).
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
      const at = this.clock.now();
      const { opened, receipt } = await this.reservations.open({
        id: newId<'Reservation'>(),
        orderId,
        expiresAt: new Date(at.getTime() + this.ttlSeconds * 1_000),
        at,
      });
      if (!opened) return receipt;
      const plans = ONE_WAREHOUSE_PER_ORDER.plans(
        await this.stockOf(merged),
        merged,
      );
      for (const plan of plans) {
        if (await this.reserveAll(receipt, plan, at)) return receipt;
      }
      // What the closest warehouse leaves out now: another order may have taken units since they were read.
      throw new InsufficientStockError(
        shortInClosest(await this.stockOf(merged), merged),
      );
    });
  }

  /**
   * The warehouses the confirmed stock of an order left from, with its units: a group per warehouse (ADR-0160),
   * which is one while an order is reserved in one warehouse. None when its stock was not confirmed.
   */
  allocationOf(orderId: OrderId): Promise<Allocation[]> {
    return this.transactions.run(() => this.reservations.allocationOf(orderId));
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
   * Each line writes a RESTOCK movement with its reason, order, line, note and who did it, in the first active
   * warehouse by priority until restocks go back to the warehouse they left (ADR-0160, T-162 part b).
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
      const warehouse = await this.warehouses.firstActive();
      // A migration creates the first one (ADR-0127), and none can be deactivated yet.
      if (warehouse === null) throw new Error('There is no active warehouse');
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

  /** The active warehouses, by priority, with what each has available of the requests. */
  private stockOf(requests: readonly StockRequest[]) {
    return this.queries.activeStock(requests.map(({ variantId }) => variantId));
  }

  /**
   * Reserves every group of a plan in its warehouse as one step, which undoes itself when a group is short
   * (ADR-0133): the units read as available may have gone to another order. Whether it reserved them.
   */
  private async reserveAll(
    receipt: ReservationReceipt,
    plan: readonly Allocation[],
    at: Date,
  ): Promise<boolean> {
    try {
      await this.transactions.runNested(async () => {
        for (const { warehouseId, lines } of plan) {
          const short = await this.reservations.reserve(
            receipt.reservationId,
            warehouseId,
            lines,
            at,
          );
          if (short.length > 0) throw new InsufficientStockError(short);
        }
      });
      return true;
    } catch (error) {
      if (error instanceof InsufficientStockError) return false;
      throw error;
    }
  }
}
