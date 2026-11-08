import { InvalidValueError, newId } from '../../../shared-kernel/index.js';
import {
  CashClosing,
  CashClosingNoteRequiredError,
  type CashDay,
} from './cash-closing.js';

const NOW = new Date('2026-11-08T03:00:00.000Z');

const DAY: CashDay = {
  placedCount: 2,
  placedAmount: 50_000,
  pendingPaymentCount: 0,
  cancelledCount: 0,
  payments: [
    { method: 'CASH', count: 1, amount: 30_000 },
    { method: 'CARD_TERMINAL', count: 1, amount: 20_000 },
    { method: 'TRANSFER', count: 0, amount: 0 },
    { method: null, count: 0, amount: 0 },
  ],
  paymentAmount: 50_000,
  refundCount: 0,
  refundAmount: 0,
  cashRefundAmount: 0,
  expectedCash: 30_000,
  byStaff: [],
  openPriceLineCount: 0,
  openPriceAmount: 0,
};

function close(countedCash: number, note: string | null = null): CashClosing {
  return CashClosing.close({
    id: newId<'CashClosing'>(),
    warehouseId: newId<'Warehouse'>(),
    date: '2026-11-07',
    summary: DAY,
    countedCash,
    note,
    closedBy: newId<'User'>(),
    now: NOW,
  });
}

describe('CashClosing', () => {
  it('keeps the expected cash of the summary and no difference when the count matches', () => {
    const closing = close(30_000).snapshot;

    expect(closing).toMatchObject({
      date: '2026-11-07',
      expectedCash: 30_000,
      countedCash: 30_000,
      difference: 0,
      note: null,
      closedAt: NOW,
    });
    expect(closing.summary).toBe(DAY);
  });

  it('subtracts the expected cash from the counted one', () => {
    expect(close(28_000, 'Faltan $20').snapshot.difference).toBe(-2_000);
    expect(close(31_000, 'Sobran $10').snapshot.difference).toBe(1_000);
  });

  it('needs a note to say why the count differs', () => {
    expect(() => close(28_000)).toThrow(CashClosingNoteRequiredError);
    expect(() => close(28_000, '   ')).toThrow(CashClosingNoteRequiredError);
  });

  it('trims the note, and keeps none when it is blank', () => {
    expect(close(30_000, '  Todo cuadra  ').snapshot.note).toBe('Todo cuadra');
    expect(close(30_000, ' ').snapshot.note).toBeNull();
  });

  it('rejects a counted cash out of its limits and a note too long', () => {
    expect(() => close(-1)).toThrow(InvalidValueError);
    expect(() => close(10.5)).toThrow(InvalidValueError);
    expect(() => close(30_000, 'x'.repeat(501))).toThrow(InvalidValueError);
    expect(close(28_000, 'x'.repeat(500)).snapshot.note).toHaveLength(500);
  });
});
