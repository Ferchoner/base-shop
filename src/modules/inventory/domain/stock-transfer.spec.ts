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
      kind: 'TRANSFER',
      fromWarehouseId: from,
      toWarehouseId: to,
      reason: 'SALE',
      note: 'Para el cliente de la mañana',
      status: 'COMPLETED',
      lines: [
        { variantId: game, quantity: 2, returned: null },
        { variantId: console, quantity: 1, returned: null },
      ],
      createdBy: 'staff-1',
      createdAt: now,
      cancelledBy: null,
      cancelledAt: null,
      returnBy: null,
      closedBy: null,
      closedAt: null,
      loanId: null,
      returnTransferId: null,
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
    ).toEqual([{ variantId: game, quantity: 100_000, returned: null }]);
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

  describe('loan (T-164)', () => {
    const inAnHour = new Date('2026-11-08T19:00:00.000Z');
    const loan = (overrides: Parameters<typeof record>[0] = {}) =>
      record({
        kind: 'LOAN',
        reason: 'SHOW',
        returnBy: inAnHour,
        lines: [
          { variantId: game, quantity: 2 },
          { variantId: console, quantity: 1 },
        ],
        ...overrides,
      });

    it('is open until it comes back, from 5 minutes to 24 hours later, and overdue after that', () => {
      const open = loan();

      expect(open.snapshot).toMatchObject({
        kind: 'LOAN',
        reason: 'SHOW',
        status: 'OPEN',
        returnBy: inAnHour,
      });
      expect(open.isCancellable).toBe(true);
      expect(open.isOverdue(inAnHour)).toBe(false);
      expect(open.isOverdue(new Date(inAnHour.getTime() + 1))).toBe(true);
      expect(
        loan({ returnBy: new Date('2026-11-08T18:05:00.000Z') }).snapshot
          .status,
      ).toBe('OPEN');
      expect(
        loan({ returnBy: new Date('2026-11-09T18:00:00.000Z') }).snapshot
          .status,
      ).toBe('OPEN');
      for (const returnBy of [
        null,
        new Date('2026-11-08T18:04:59.999Z'),
        new Date('2026-11-09T18:00:00.001Z'),
      ]) {
        expect(fieldOf(() => loan({ returnBy }))).toMatchObject({
          errors: [{ field: 'returnBy', code: 'loanRange' }],
        });
      }
    });

    it('goes with SHOW, and a transfer neither with SHOW, LOAN_RETURN nor a time to come back', () => {
      expect(fieldOf(() => loan({ reason: 'SALE' }))).toMatchObject({
        errors: [{ field: 'reason', code: 'reasonKind' }],
      });
      expect(fieldOf(() => record({ reason: 'SHOW' }))).toMatchObject({
        errors: [{ field: 'reason', code: 'reasonKind' }],
      });
      expect(fieldOf(() => record({ reason: 'LOAN_RETURN' }))).toMatchObject({
        errors: [{ field: 'reason', code: 'reasonKind' }],
      });
      expect(fieldOf(() => record({ returnBy: inAnHour }))).toMatchObject({
        errors: [{ field: 'returnBy', code: 'isEmpty' }],
      });
    });

    it('closes with what came back of each line, and its return brings back only that', () => {
      const open = loan();
      const at = new Date('2026-11-08T18:30:00.000Z');

      open.close(
        [
          { variantId: console, returned: 0 },
          { variantId: game, returned: 1 },
        ],
        'staff-2',
        at,
      );
      const back = StockTransfer.returnOf(open, {
        id: newId<'StockTransfer'>(),
        staffId: 'staff-2',
        now: at,
      });

      expect(open.snapshot).toMatchObject({
        status: 'CLOSED',
        closedBy: 'staff-2',
        closedAt: at,
        lines: [
          { variantId: game, quantity: 2, returned: 1 },
          { variantId: console, quantity: 1, returned: 0 },
        ],
      });
      expect(open.isCancellable).toBe(false);
      expect(open.isOverdue(new Date('2026-11-10T00:00:00.000Z'))).toBe(false);
      expect(back.snapshot).toMatchObject({
        kind: 'TRANSFER',
        reason: 'LOAN_RETURN',
        status: 'COMPLETED',
        fromWarehouseId: to,
        toWarehouseId: from,
        loanId: open.id,
        returnBy: null,
        lines: [{ variantId: game, quantity: 1, returned: null }],
      });
      expect(back.isCancellable).toBe(false);
      expect(() => back.cancel('staff-2', at)).toThrow(
        InvalidStateTransitionError,
      );
      expect(() => open.close([], 'staff-2', at)).toThrow(
        InvalidStateTransitionError,
      );
    });

    it('closes with every line of the loan once, and 0 to the units it took', () => {
      const close = (lines: { variantId: typeof game; returned: number }[]) =>
        fieldOf(() => loan().close(lines, 'staff-2', now));

      expect(close([{ variantId: game, returned: 2 }])).toMatchObject({
        errors: [{ field: 'lines', code: 'loanLines' }],
      });
      expect(
        close([
          { variantId: game, returned: 2 },
          { variantId: game, returned: 2 },
        ]),
      ).toMatchObject({
        errors: [{ field: 'lines[1].variantId', code: 'loanLines' }],
      });
      expect(
        close([
          { variantId: game, returned: 0 },
          { variantId: newId<'Variant'>(), returned: 0 },
        ]),
      ).toMatchObject({
        errors: [{ field: 'lines[1].variantId', code: 'loanLines' }],
      });
      expect(
        close([
          { variantId: game, returned: 3 },
          { variantId: console, returned: 0 },
        ]),
      ).toMatchObject({
        errors: [{ field: 'lines[0].returned', code: 'range' }],
      });
      expect(() => record().close([], 'staff-2', now)).toThrow(
        InvalidStateTransitionError,
      );
    });

    it('is cancelled like a transfer, only while it is open', () => {
      const open = loan();
      open.cancel('staff-2', now);
      expect(open.snapshot.status).toBe('CANCELLED');

      const late = loan();
      expect(() =>
        late.cancel('staff-2', new Date('2026-11-08T18:10:00.001Z')),
      ).toThrow(
        expect.objectContaining({
          details: { currentStatus: 'OPEN', reason: 'cancel-window-passed' },
        }),
      );
    });
  });

  describe('folio', () => {
    it('is T- and at least six digits, and reads the ways the staff types it', () => {
      expect(formatTransferFolio(123)).toBe('T-000123');
      expect(formatTransferFolio(1_234_567)).toBe('T-1234567');
      expect(formatTransferFolio(123, 'LOAN')).toBe('P-000123');
      expect(parseTransferFolio('p-000123')).toBe(123);
      expect(parseTransferFolio('T-000123')).toBe(123);
      expect(parseTransferFolio(' t-123 ')).toBe(123);
      expect(parseTransferFolio('T123')).toBe(123);
      expect(parseTransferFolio('123')).toBe(123);
      expect(parseTransferFolio('OT-123')).toBeNull();
      expect(parseTransferFolio('T-')).toBeNull();
    });
  });
});
