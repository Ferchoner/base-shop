import { InvalidValueError, newId } from '../../../shared-kernel/index.js';
import {
  ADJUSTMENT_REASONS,
  AdjustmentDirectionError,
  AdjustmentNoteRequiredError,
  checkAdjustment,
  InsufficientStockError,
  MAX_STOCK_QUANTITY,
  noteOf,
  receiptQuantity,
} from './stock.js';

describe('Stock rules (UC-INV-02, UC-INV-03, ADR-0069)', () => {
  it.each([1, 25, MAX_STOCK_QUANTITY])(
    'takes a receipt of %d units',
    (quantity) => {
      expect(receiptQuantity(quantity)).toBe(quantity);
    },
  );

  it.each([0, -1, 1.5, MAX_STOCK_QUANTITY + 1])(
    'rejects a receipt of %d units',
    (quantity) => {
      expect(() => receiptQuantity(quantity)).toThrow(InvalidValueError);
    },
  );

  it('takes an adjustment either way for the reasons that allow it', () => {
    for (const reasonCode of [
      'PHYSICAL_COUNT',
      'DATA_ENTRY_ERROR',
      'WAREHOUSE_TRANSFER',
    ] as const) {
      for (const quantity of [5, -5, MAX_STOCK_QUANTITY, -MAX_STOCK_QUANTITY]) {
        expect(() =>
          checkAdjustment({ quantity, reasonCode, note: null }),
        ).not.toThrow();
      }
    }
  });

  it.each(['DAMAGED', 'LOSS_OR_THEFT', 'INTERNAL_USE'] as const)(
    'takes %s only to take stock away',
    (reasonCode) => {
      expect(() =>
        checkAdjustment({ quantity: -2, reasonCode, note: null }),
      ).not.toThrow();
      expect(() =>
        checkAdjustment({ quantity: 2, reasonCode, note: null }),
      ).toThrow(AdjustmentDirectionError);
    },
  );

  it('asks for a note with OTHER', () => {
    expect(() =>
      checkAdjustment({ quantity: 3, reasonCode: 'OTHER', note: null }),
    ).toThrow(AdjustmentNoteRequiredError);
    expect(() =>
      checkAdjustment({ quantity: 3, reasonCode: 'OTHER', note: 'Regalo' }),
    ).not.toThrow();
    expect(new AdjustmentNoteRequiredError().details).toEqual({
      errors: [expect.objectContaining({ field: 'note', code: 'isNotEmpty' })],
    });
  });

  it.each([0, 1.5, MAX_STOCK_QUANTITY + 1, -MAX_STOCK_QUANTITY - 1])(
    'rejects an adjustment of %d units',
    (quantity) => {
      expect(() =>
        checkAdjustment({ quantity, reasonCode: 'PHYSICAL_COUNT', note: null }),
      ).toThrow(InvalidValueError);
    },
  );

  it('answers the direction of a reason on the quantity field', () => {
    expect(new AdjustmentDirectionError().details).toEqual({
      errors: [
        expect.objectContaining({ field: 'quantity', code: 'reasonDirection' }),
      ],
    });
    expect(ADJUSTMENT_REASONS).toHaveLength(7);
  });

  it('keeps a note trimmed, and none for blank', () => {
    expect(noteOf('  Remisión 1234 ')).toBe('Remisión 1234');
    expect(noteOf('   ')).toBeNull();
    expect(noteOf(undefined)).toBeNull();
    expect(noteOf(null)).toBeNull();
  });

  it('answers a lack of stock as insufficient-stock with the variant', () => {
    const variantId = newId<'Variant'>();

    expect(new InsufficientStockError([variantId])).toMatchObject({
      code: 'insufficient-stock',
      category: 'conflict',
      details: { lines: [{ variantId, canFulfill: false }] },
    });
  });
});
