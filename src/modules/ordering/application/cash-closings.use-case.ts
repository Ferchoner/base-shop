import { Injectable } from '@nestjs/common';
import {
  AuditTrail,
  changesBetween,
  Clock,
  DuplicateValueError,
  InvalidValueError,
  isCalendarDate,
  mexicoDateOf,
  mexicoDayBounds,
  newId,
  NotFoundError,
  type Page,
  type PageRequest,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import {
  CashClosing,
  type CashClosingId,
  type CashDay,
  COLLECTION_METHODS,
  type CollectionMethod,
  type StaffTotal,
} from '../domain/cash-closing.js';
import {
  type CashClosingFilter,
  CashClosingRepository,
} from '../domain/cash-closing.repository.js';
import type { OrderId, StaffId, WarehouseId } from '../domain/order.js';
import { OrderingQueries } from './ordering.queries.js';
import {
  type CaptureMovement,
  OrderPayments,
  type RefundMovement,
} from './payment-ports.js';
import { OrderWarehouses } from './warehouse-ports.js';

// For the presentation, which does not reach the domain (ADR-0171).
export {
  COLLECTION_METHODS,
  MAX_CASH_CLOSING_NOTE_LENGTH,
} from '../domain/cash-closing.js';
export type {
  CashClosing,
  CashDay,
  CollectionMethod,
} from '../domain/cash-closing.js';

/** What came in and went out after the closing of the day, in cents (ADR-0171). */
export interface AfterClosing {
  readonly paymentCount: number;
  readonly paymentAmount: number;
  readonly cashAmount: number;
  readonly refundCount: number;
  readonly refundAmount: number;
  readonly cashRefundAmount: number;
}

/** The cash of a warehouse in a day of central Mexico, with its closing if it has one (ADR-0171). */
export interface CashSummary extends CashDay {
  readonly warehouseId: WarehouseId;
  readonly date: string;
  /** When the day starts and ends, the end excluded. */
  readonly from: Date;
  readonly to: Date;
  readonly closing: CashClosing | null;
  /** `null` while the day has no closing. */
  readonly afterClosing: AfterClosing | null;
}

/**
 * The cash closing of each store (UC-ORD-16 and 17, ADR-0171): the summary of a warehouse and a day of central Mexico,
 * built from the store orders of Ordering and the payments and refunds of Payments, and the closing with the cash the
 * staff counted. A closing is audited as `cash-closings.close` and never changes.
 */
@Injectable()
export class CashClosings {
  constructor(
    private readonly queries: OrderingQueries,
    private readonly payments: OrderPayments,
    private readonly warehouses: OrderWarehouses,
    private readonly closings: CashClosingRepository,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  /**
   * The summary of the day, now, with what came after its closing.
   *
   * @throws InvalidValueError for a date that is not a day of the calendar; NotFoundError for a warehouse that does
   *   not exist.
   */
  async summary(warehouseId: WarehouseId, date: string): Promise<CashSummary> {
    assertDate(date);
    await this.assertWarehouse(warehouseId);
    const { start, end } = mexicoDayBounds(date);
    const [day, closing] = await Promise.all([
      this.day(warehouseId, start, end),
      this.closings.findByDay(warehouseId, date),
    ]);
    return {
      ...day.figures,
      warehouseId,
      date,
      from: start,
      to: end,
      closing,
      afterClosing:
        closing === null ? null : afterClosing(day, closing.snapshot.closedAt),
    };
  }

  /**
   * Closes the cash of the day with the cash the staff counted (UC-ORD-17): keeps the summary of now, the expected
   * cash and the difference. Today or a day before, once per warehouse and day.
   *
   * @throws InvalidValueError for a date that is not a day of the calendar or is still to come, or a counted cash
   *   out of its limits; CashClosingNoteRequiredError; NotFoundError for a warehouse that does not exist;
   *   DuplicateValueError `date` when the day is closed already.
   */
  async close(input: {
    warehouseId: WarehouseId;
    date: string;
    countedCash: number;
    note: string | null;
    staffId: StaffId;
  }): Promise<CashClosingId> {
    assertDate(input.date);
    const now = this.clock.now();
    if (input.date > mexicoDateOf(now)) {
      throw new InvalidValueError('A day still to come cannot be closed', {
        errors: [
          {
            field: 'date',
            code: 'notFuture',
            message: 'El día todavía no llega.',
          },
        ],
      });
    }
    return this.transactions.run(async () => {
      await this.assertWarehouse(input.warehouseId);
      const { start, end } = mexicoDayBounds(input.date);
      const day = await this.day(input.warehouseId, start, end);
      const closing = CashClosing.close({
        id: newId<'CashClosing'>(),
        warehouseId: input.warehouseId,
        date: input.date,
        summary: day.figures,
        countedCash: input.countedCash,
        note: input.note,
        closedBy: input.staffId,
        now,
      });
      if (!(await this.closings.insert(closing))) {
        throw new DuplicateValueError('date');
      }
      const { expectedCash, countedCash, difference } = closing.snapshot;
      // Amounts and identifiers only: the note is free text of the staff.
      await this.audit.record({
        action: 'cash-closings.close',
        resource: { type: 'cash-closing', id: closing.id },
        changes: changesBetween(
          {
            warehouseId: null,
            date: null,
            expectedCash: null,
            countedCash: null,
            difference: null,
          },
          {
            warehouseId: input.warehouseId,
            date: input.date,
            expectedCash,
            countedCash,
            difference,
          },
        ),
      });
      return closing.id;
    });
  }

  /** @throws NotFoundError when there is no closing with that ID. */
  async find(id: CashClosingId): Promise<CashClosing> {
    const closing = await this.closings.findById(id);
    if (closing === null) throw new NotFoundError('CashClosing', id);
    return closing;
  }

  /** @throws InvalidValueError for a date of the filter that is not a day of the calendar. */
  list(
    filter: CashClosingFilter,
    page: PageRequest,
  ): Promise<Page<CashClosing>> {
    for (const date of [filter.dateFrom, filter.dateTo]) {
      if (date !== undefined) assertDate(date);
    }
    return this.closings.list(filter, page);
  }

  /** @throws NotFoundError unless the warehouse exists, active or not. */
  private async assertWarehouse(warehouseId: WarehouseId): Promise<void> {
    if ((await this.warehouses.warehouse(warehouseId)) === null) {
      throw new NotFoundError('Warehouse', warehouseId);
    }
  }

  /** The movements of the store orders of the warehouse in the day, and its figures. */
  private async day(
    warehouseId: WarehouseId,
    start: Date,
    end: Date,
  ): Promise<Day> {
    const [movements, orders, openPrice] = await Promise.all([
      this.payments.movementsBetween(start, end),
      this.queries.storeDayOrders(warehouseId, start, end),
      this.queries.openPriceTotals(warehouseId, start, end),
    ]);
    const ids = [
      ...new Set<OrderId>([
        ...movements.captures.map(({ orderId }) => orderId),
        ...movements.refunds.map(({ orderId }) => orderId),
      ]),
    ];
    const ofWarehouse = new Set(
      ids.length === 0
        ? []
        : (await this.queries.storeOrders(ids))
            .filter((order) => order.warehouseId === warehouseId)
            .map(({ id }) => id),
    );
    const captures = movements.captures.filter(({ orderId }) =>
      ofWarehouse.has(orderId),
    );
    const refunds = movements.refunds.filter(({ orderId }) =>
      ofWarehouse.has(orderId),
    );
    const within = (at: Date | null) => at !== null && at >= start && at < end;
    const placed = orders.filter(({ placedAt }) => within(placedAt));
    const cashAmount = sum(cashOf(captures));
    const cashRefundAmount = sum(
      refunds.filter(({ paymentMethod }) => paymentMethod === 'CASH'),
    );
    return {
      captures,
      refunds,
      figures: {
        placedCount: placed.length,
        placedAmount: placed.reduce(
          (total, order) => total + order.totals.grandTotal.amount,
          0,
        ),
        pendingPaymentCount: placed.filter(
          ({ status }) => status === 'PENDING_PAYMENT',
        ).length,
        cancelledCount: orders.filter(({ cancelledAt }) => within(cancelledAt))
          .length,
        payments: [...COLLECTION_METHODS, null].map((method) => {
          const collected = captures.filter((capture) =>
            sameMethod(capture.method, method),
          );
          return {
            method,
            count: collected.length,
            amount: sum(collected),
          };
        }),
        paymentAmount: sum(captures),
        refundCount: refunds.length,
        refundAmount: sum(refunds),
        cashRefundAmount,
        expectedCash: cashAmount - cashRefundAmount,
        byStaff: byStaff(captures, refunds),
        openPriceLineCount: openPrice.count,
        openPriceAmount: openPrice.amount,
      },
    };
  }
}

interface Day {
  readonly captures: readonly CaptureMovement[];
  readonly refunds: readonly RefundMovement[];
  readonly figures: CashDay;
}

/** @throws InvalidValueError on `date` for a text that is not a day of the calendar, `YYYY-MM-DD`. */
function assertDate(date: string): void {
  if (!isCalendarDate(date)) {
    throw new InvalidValueError(`Not a calendar date: ${date}`, {
      errors: [
        {
          field: 'date',
          code: 'isDate',
          message: 'Debe ser una fecha AAAA-MM-DD.',
        },
      ],
    });
  }
}

/** What came after the closing: the movements of the day later than it. */
function afterClosing(day: Day, closedAt: Date): AfterClosing {
  const captures = day.captures.filter(
    ({ capturedAt }) => capturedAt > closedAt,
  );
  const refunds = day.refunds.filter(
    ({ completedAt }) => completedAt > closedAt,
  );
  return {
    paymentCount: captures.length,
    paymentAmount: sum(captures),
    cashAmount: sum(cashOf(captures)),
    refundCount: refunds.length,
    refundAmount: sum(refunds),
    cashRefundAmount: sum(
      refunds.filter(({ paymentMethod }) => paymentMethod === 'CASH'),
    ),
  };
}

/**
 * By the staff member who registered each payment or refund, in the order they first appear; the movements no one
 * registered go together, last.
 */
function byStaff(
  captures: readonly CaptureMovement[],
  refunds: readonly RefundMovement[],
): StaffTotal[] {
  const staff = [
    ...new Set([
      ...captures.map(({ registeredBy }) => registeredBy),
      ...refunds.map(({ registeredBy }) => registeredBy),
    ]),
  ].sort((a, b) => (a === null ? 1 : b === null ? -1 : 0));
  return staff.map((staffId) => {
    const collected = captures.filter(
      ({ registeredBy }) => registeredBy === staffId,
    );
    return {
      staffId,
      paymentCount: collected.length,
      paymentAmount: sum(collected),
      cashAmount: sum(cashOf(collected)),
      refundAmount: sum(
        refunds.filter(({ registeredBy }) => registeredBy === staffId),
      ),
    };
  });
}

function cashOf(
  captures: readonly CaptureMovement[],
): readonly CaptureMovement[] {
  return captures.filter(({ method }) => method === 'CASH');
}

function sameMethod(
  method: string | null,
  group: CollectionMethod | null,
): boolean {
  return method === group;
}

function sum(
  movements: readonly { readonly amount: { amount: number } }[],
): number {
  return movements.reduce((total, { amount }) => total + amount.amount, 0);
}
