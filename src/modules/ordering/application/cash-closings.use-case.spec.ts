import {
  type AuditEntry,
  type AuditTrail,
  type Clock,
  DuplicateValueError,
  InvalidValueError,
  Money,
  newId,
  NotFoundError,
  type TransactionManager,
} from '../../../shared-kernel/index.js';
import type { CashClosing } from '../domain/cash-closing.js';
import type { CashClosingRepository } from '../domain/cash-closing.repository.js';
import type { OrderId, StaffId, WarehouseId } from '../domain/order.js';
import { CashClosings } from './cash-closings.use-case.js';
import type {
  AdminOrderSummaryView,
  OrderingQueries,
} from './ordering.queries.js';
import type {
  CaptureMovement,
  OrderPayments,
  RefundMovement,
} from './payment-ports.js';
import type { OrderWarehouses } from './warehouse-ports.js';

const LOCAL_204 = newId<'Warehouse'>();
const LOCAL_206 = newId<'Warehouse'>();
const OWNER = newId<'User'>();
const HELPER = newId<'User'>();
/** 2026-11-07 in central Mexico, UTC−6: from 06:00 UTC to 06:00 UTC of the next day. */
const DATE = '2026-11-07';
const START = new Date('2026-11-07T06:00:00.000Z');
const END = new Date('2026-11-08T06:00:00.000Z');
const NOW = new Date('2026-11-08T03:00:00.000Z');

const mxn = (amount: number) => Money.of(amount, 'MXN');
const at = (time: string) => new Date(`2026-11-07T${time}.000Z`);

function order(
  warehouseId: WarehouseId,
  changes: Partial<{
    placedAt: Date;
    cancelledAt: Date | null;
    status: string;
    total: number;
  }> = {},
): AdminOrderSummaryView {
  return {
    id: newId<'Order'>(),
    warehouseId,
    placedAt: changes.placedAt ?? at('16:00:00'),
    cancelledAt: changes.cancelledAt ?? null,
    status: changes.status ?? 'PAID',
    totals: { grandTotal: mxn(changes.total ?? 10_000) },
  } as unknown as AdminOrderSummaryView;
}

function capture(
  orderId: OrderId,
  amount: number,
  method: CaptureMovement['method'],
  registeredBy: StaffId | null = HELPER,
  capturedAt = at('17:00:00'),
): CaptureMovement {
  return { orderId, amount: mxn(amount), method, registeredBy, capturedAt };
}

function refund(
  orderId: OrderId,
  amount: number,
  paymentMethod: RefundMovement['paymentMethod'],
  completedAt = at('18:00:00'),
): RefundMovement {
  return {
    orderId,
    amount: mxn(amount),
    paymentMethod,
    registeredBy: OWNER,
    completedAt,
  };
}

function setUp(
  options: {
    orders?: AdminOrderSummaryView[];
    captures?: CaptureMovement[];
    refunds?: RefundMovement[];
    closing?: CashClosing | null;
    duplicate?: boolean;
    warehouse?: boolean;
  } = {},
) {
  const orders = options.orders ?? [];
  const windows: { from: Date; to: Date }[] = [];
  const queries = {
    storeDayOrders: (warehouseId: WarehouseId, from: Date, to: Date) => {
      windows.push({ from, to });
      return Promise.resolve(
        orders.filter((o) => o.warehouseId === warehouseId),
      );
    },
    storeOrders: (ids: readonly OrderId[]) =>
      Promise.resolve(orders.filter((o) => ids.includes(o.id))),
    openPriceTotals: () => Promise.resolve({ count: 1, amount: 2_500 }),
  } as unknown as OrderingQueries;
  const payments = {
    movementsBetween: () =>
      Promise.resolve({
        captures: options.captures ?? [],
        refunds: options.refunds ?? [],
      }),
  } as unknown as OrderPayments;
  const warehouses = {
    warehouse: () =>
      Promise.resolve(options.warehouse === false ? null : { id: LOCAL_204 }),
  } as unknown as OrderWarehouses;
  const inserted: CashClosing[] = [];
  const closings = {
    insert: (closing: CashClosing) => {
      inserted.push(closing);
      return Promise.resolve(options.duplicate !== true);
    },
    findByDay: () => Promise.resolve(options.closing ?? null),
    findById: (id: string) =>
      Promise.resolve(inserted.find((c) => c.id === id) ?? null),
    list: () => Promise.resolve({ items: [], totalItems: 0 }),
  } as unknown as CashClosingRepository;
  const transactions = {
    run: <T>(work: () => Promise<T>) => work(),
  } as unknown as TransactionManager;
  const audited: AuditEntry[] = [];
  const audit = {
    record: (entry: AuditEntry) => {
      audited.push(entry);
      return Promise.resolve();
    },
  } as unknown as AuditTrail;
  const clock = { now: () => NOW } as Clock;
  return {
    useCase: new CashClosings(
      queries,
      payments,
      warehouses,
      closings,
      transactions,
      audit,
      clock,
    ),
    inserted,
    audited,
    windows,
  };
}

describe('CashClosings', () => {
  describe('summary', () => {
    it('adds up the store orders, payments and refunds of the warehouse in the day of central Mexico', async () => {
      const paidCash = order(LOCAL_204, { total: 30_000 });
      const paidCard = order(LOCAL_204, { total: 20_000 });
      const pending = order(LOCAL_204, {
        status: 'PENDING_PAYMENT',
        total: 5_000,
      });
      /** Placed the day before: its payment counts, it does not. */
      const yesterday = order(LOCAL_204, {
        placedAt: new Date('2026-11-06T20:00:00.000Z'),
        cancelledAt: at('15:00:00'),
        status: 'CANCELLED',
      });
      const other = order(LOCAL_206, { total: 99_000 });
      const { useCase, windows } = setUp({
        orders: [paidCash, paidCard, pending, yesterday, other],
        captures: [
          capture(paidCash.id, 30_000, 'CASH'),
          capture(paidCard.id, 20_000, 'CARD_TERMINAL', OWNER),
          capture(yesterday.id, 4_000, null, null),
          capture(other.id, 99_000, 'CASH'),
        ],
        refunds: [
          refund(paidCash.id, 1_000, 'CASH'),
          refund(paidCard.id, 2_000, 'CARD_TERMINAL'),
        ],
      });

      const summary = await useCase.summary(LOCAL_204, DATE);

      expect(windows).toEqual([{ from: START, to: END }]);
      expect(summary).toMatchObject({
        warehouseId: LOCAL_204,
        date: DATE,
        from: START,
        to: END,
        placedCount: 3,
        placedAmount: 55_000,
        pendingPaymentCount: 1,
        cancelledCount: 1,
        payments: [
          { method: 'CASH', count: 1, amount: 30_000 },
          { method: 'CARD_TERMINAL', count: 1, amount: 20_000 },
          { method: 'TRANSFER', count: 0, amount: 0 },
          { method: null, count: 1, amount: 4_000 },
        ],
        paymentAmount: 54_000,
        refundCount: 2,
        refundAmount: 3_000,
        cashRefundAmount: 1_000,
        expectedCash: 29_000,
        openPriceLineCount: 1,
        openPriceAmount: 2_500,
        closing: null,
        afterClosing: null,
      });
      expect(summary.byStaff).toEqual([
        {
          staffId: HELPER,
          paymentCount: 1,
          paymentAmount: 30_000,
          cashAmount: 30_000,
          refundAmount: 0,
        },
        {
          staffId: OWNER,
          paymentCount: 1,
          paymentAmount: 20_000,
          cashAmount: 0,
          refundAmount: 3_000,
        },
        {
          staffId: null,
          paymentCount: 1,
          paymentAmount: 4_000,
          cashAmount: 0,
          refundAmount: 0,
        },
      ]);
    });

    it('shows what came after the closing', async () => {
      const sold = order(LOCAL_204);
      const closed = setUp({
        orders: [sold],
        captures: [capture(sold.id, 10_000, 'CASH')],
      });
      await closed.useCase.close({
        warehouseId: LOCAL_204,
        date: DATE,
        countedCash: 10_000,
        note: null,
        staffId: OWNER,
      });
      const { useCase } = setUp({
        orders: [sold],
        captures: [
          capture(sold.id, 10_000, 'CASH', HELPER, at('17:00:00')),
          capture(sold.id, 7_000, 'CASH', HELPER, new Date(NOW.getTime() + 1)),
        ],
        refunds: [refund(sold.id, 500, 'CASH', new Date(NOW.getTime() + 2))],
        closing: closed.inserted[0],
      });

      const summary = await useCase.summary(LOCAL_204, DATE);

      expect(summary.expectedCash).toBe(16_500);
      expect(summary.closing?.snapshot.expectedCash).toBe(10_000);
      expect(summary.afterClosing).toEqual({
        paymentCount: 1,
        paymentAmount: 7_000,
        cashAmount: 7_000,
        refundCount: 1,
        refundAmount: 500,
        cashRefundAmount: 500,
      });
    });

    it('rejects a date that is not a day of the calendar, and a warehouse that does not exist', async () => {
      await expect(
        setUp().useCase.summary(LOCAL_204, '2026-02-30'),
      ).rejects.toThrow(InvalidValueError);
      await expect(
        setUp({ warehouse: false }).useCase.summary(LOCAL_204, DATE),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('close', () => {
    it('keeps the summary and the difference, and audits the amounts without the note', async () => {
      const sold = order(LOCAL_204);
      const { useCase, inserted, audited } = setUp({
        orders: [sold],
        captures: [capture(sold.id, 10_000, 'CASH')],
      });

      const id = await useCase.close({
        warehouseId: LOCAL_204,
        date: DATE,
        countedCash: 9_000,
        note: 'Faltan $10',
        staffId: OWNER,
      });

      expect(inserted[0]?.id).toBe(id);
      expect(inserted[0]?.snapshot).toMatchObject({
        warehouseId: LOCAL_204,
        date: DATE,
        expectedCash: 10_000,
        countedCash: 9_000,
        difference: -1_000,
        note: 'Faltan $10',
        closedBy: OWNER,
        closedAt: NOW,
      });
      expect(audited).toEqual([
        {
          action: 'cash-closings.close',
          resource: { type: 'cash-closing', id },
          changes: {
            warehouseId: { from: null, to: LOCAL_204 },
            date: { from: null, to: DATE },
            expectedCash: { from: null, to: 10_000 },
            countedCash: { from: null, to: 9_000 },
            difference: { from: null, to: -1_000 },
          },
        },
      ]);
    });

    it('answers a day closed already as a duplicate date', async () => {
      const { useCase, audited } = setUp({ duplicate: true });

      await expect(
        useCase.close({
          warehouseId: LOCAL_204,
          date: DATE,
          countedCash: 0,
          note: null,
          staffId: OWNER,
        }),
      ).rejects.toThrow(DuplicateValueError);
      expect(audited).toEqual([]);
    });

    it('rejects a day still to come', async () => {
      const { useCase, inserted } = setUp();

      await expect(
        useCase.close({
          warehouseId: LOCAL_204,
          date: '2026-11-08',
          countedCash: 0,
          note: null,
          staffId: OWNER,
        }),
      ).rejects.toMatchObject({
        details: { errors: [{ field: 'date', code: 'notFuture' }] },
      });
      expect(inserted).toEqual([]);
    });
  });

  it('finds a closing or answers it is missing', async () => {
    await expect(setUp().useCase.find(newId<'CashClosing'>())).rejects.toThrow(
      NotFoundError,
    );
  });
});
