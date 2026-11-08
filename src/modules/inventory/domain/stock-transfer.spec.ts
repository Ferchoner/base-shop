import {
  InvalidStateTransitionError,
  InvalidValueError,
  newId,
  toId,
} from '../../../shared-kernel/index.js';
import {
  formatTransferFolio,
  parseTransferFolio,
  StockTransfer,
  TransferCancelWindowError,
  TransferFieldError,
} from './stock-transfer.js';

const from = toId<'Warehouse'>('01a0b000-0000-7000-8000-000000000204');
const to = toId<'Warehouse'>('01a0b000-0000-7000-8000-000000000206');
const game = newId<'Variant'>();
const console = newId<'Variant'>();
const now = new Date('2026-11-08T18:00:00.000Z');

const record = (
  overrides: Partial<Parameters<typeof StockTransfer.record>[0]> = {},
) =>
  StockTransfer.record({
    id: newId<'StockTransfer'>(),
    fromWarehouseId: from,
    toWarehouseId: to,
    reason: 'SALE',
    lines: [{ variantId: game, quantity: 2 }],
    staffId: 'staff-1',
    now,
    ...overrides,
  });

const fieldOf = (action: () => unknown) => {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(TransferFieldError);
    return (error as TransferFieldError).details;
  }
  throw new Error('It did not throw');
};

describe('StockTransfer (T-163, ADR-0172)', () => {
  it('is done as it is recorded, with its lines and who recorded it', () => {
    const transfer = record({
      note: '  Para el cliente de la mañana ',
      lines: [
        { variantId: game, quantity: 2 },
        { variantId: console, quantity: 1 },
      ],
    });

    expect(transfer.snapshot).toEqual({
      id: transfer.id,
      number: null,
      fromWarehouseId: from,
      toWarehouseId: to,
      reason: 'SALE',
      note: 'Para el cliente de la mañana',
      status: 'COMPLETED',
      lines: [
        { variantId: game, quantity: 2 },
        { variantId: console, quantity: 1 },
      ],
      createdBy: 'staff-1',
      createdAt: now,
      cancelledBy: null,
      cancelledAt: null,
      version: 1,
    });
    expect(transfer.cancellableUntil).toEqual(
      new Date('2026-11-08T18:10:00.000Z'),
    );
  });

  it('goes to another warehouse', () => {
    expect(fieldOf(() => record({ toWarehouseId: from }))).toEqual({
      errors: [
        {
          field: 'toWarehouseId',
          code: 'differentWarehouse',
          message: 'Debe ser otro almacén que el de origen.',
        },
      ],
    });
  });

  it('says why in its note with OTHER, and a blank note says nothing', () => {
    expect(
      fieldOf(() => record({ reason: 'OTHER', note: '   ' })),
    ).toMatchObject({ errors: [{ field: 'note', code: 'isNotEmpty' }] });
    expect(record({ reason: 'OTHER', note: 'Exhibición' }).snapshot.note).toBe(
      'Exhibición',
    );
    expect(() => record({ note: 'x'.repeat(501) })).toThrow(InvalidValueError);
  });

  it('moves 1 to 100,000 units of each variant, once per transfer, in 1 to 100 lines', () => {
    expect(
      fieldOf(() => record({ lines: [{ variantId: game, quantity: 0 }] })),
    ).toMatchObject({
      errors: [{ field: 'lines[0].quantity', code: 'range' }],
    });
    expect(
      fieldOf(() =>
        record({ lines: [{ variantId: game, quantity: 100_001 }] }),
      ),
    ).toMatchObject({ errors: [{ field: 'lines[0].quantity' }] });
    expect(
      fieldOf(() =>
        record({
          lines: [
            { variantId: game, quantity: 1 },
            { variantId: game, quantity: 3 },
          ],
        }),
      ),
    ).toMatchObject({
      errors: [{ field: 'lines[1].variantId', code: 'duplicateVariant' }],
    });
    expect(fieldOf(() => record({ lines: [] }))).toMatchObject({
      errors: [{ field: 'lines', code: 'arrayLength' }],
    });
    expect(
      record({ lines: [{ variantId: game, quantity: 100_000 }] }).lines,
    ).toEqual([{ variantId: game, quantity: 100_000 }]);
  });

  describe('cancel', () => {
    it('is cancelled in its first 10 minutes, by whoever cancels it', () => {
      const transfer = record();
      const at = new Date('2026-11-08T18:10:00.000Z');

      transfer.cancel('staff-2', at);

      expect(transfer.snapshot).toMatchObject({
        status: 'CANCELLED',
        cancelledBy: 'staff-2',
        cancelledAt: at,
        version: 1,
      });
    });

    it('is not cancelled after 10 minutes, nor twice', () => {
      const late = record();
      expect(() =>
        late.cancel('staff-2', new Date('2026-11-08T18:10:00.001Z')),
      ).toThrow(TransferCancelWindowError);
      expect(late.snapshot.status).toBe('COMPLETED');

      const twice = record();
      twice.cancel('staff-2', now);
      expect(() => twice.cancel('staff-2', now)).toThrow(
        InvalidStateTransitionError,
      );
    });

    it('answers the passed window as an invalid state transition with its reason', () => {
      const error = new TransferCancelWindowError();

      expect(error.code).toBe('invalid-state-transition');
      expect(error.category).toBe('conflict');
      expect(error.details).toEqual({
        currentStatus: 'COMPLETED',
        reason: 'cancel-window-passed',
      });
    });
  });

  describe('folio', () => {
    it('is T- and at least six digits, and reads the ways the staff types it', () => {
      expect(formatTransferFolio(123)).toBe('T-000123');
      expect(formatTransferFolio(1_234_567)).toBe('T-1234567');
      expect(parseTransferFolio('T-000123')).toBe(123);
      expect(parseTransferFolio(' t-123 ')).toBe(123);
      expect(parseTransferFolio('T123')).toBe(123);
      expect(parseTransferFolio('123')).toBe(123);
      expect(parseTransferFolio('OT-123')).toBeNull();
      expect(parseTransferFolio('T-')).toBeNull();
    });
  });
});
