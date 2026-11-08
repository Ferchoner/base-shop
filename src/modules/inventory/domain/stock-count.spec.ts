import {
  InvalidStateTransitionError,
  InvalidValueError,
  newId,
  toId,
} from '../../../shared-kernel/index.js';
import { InvalidLocationError, type VariantId } from './stock.js';
import {
  CountFieldError,
  countFilterOf,
  countedOf,
  type CountLine,
  differenceOf,
  formatCountFolio,
  locationMatch,
  StockCount,
} from './stock-count.js';

const variant = (): VariantId => newId<'Variant'>();
const NOW = new Date(Date.UTC(2026, 10, 8, 18, 0, 0));

const fieldOf = (run: () => unknown): { field: string; code: string } => {
  try {
    run();
  } catch (error) {
    if (!(error instanceof CountFieldError)) throw error;
    const [first] = (
      error.details as { errors: { field: string; code: string }[] }
    ).errors;
    return { field: first.field, code: first.code };
  }
  throw new Error('no error');
};

describe('Count sheets (ADR-0173)', () => {
  describe('countFilterOf', () => {
    it('keeps a location in upper case, with its * when it is a prefix, and the category and the class', () => {
      expect(
        countFilterOf({ location: '  vitrina   1 ', countClass: 'A' }),
      ).toEqual({ location: 'VITRINA 1', countClass: 'A' });
      expect(countFilterOf({ location: 'a*', categoryId: 'cat' })).toEqual({
        location: 'A*',
        categoryId: 'cat',
      });
    });

    it('takes a list of variants alone, each once, from 1 to 1,000', () => {
      const ids = [variant(), variant()];
      expect(countFilterOf({ variantIds: ids })).toEqual({ variantIds: ids });

      expect(
        fieldOf(() => countFilterOf({ variantIds: ids, countClass: 'B' })),
      ).toEqual({ field: 'variantIds', code: 'variantIdsAlone' });
      expect(fieldOf(() => countFilterOf({ variantIds: [] }))).toEqual({
        field: 'variantIds',
        code: 'arrayLength',
      });
      expect(
        fieldOf(() =>
          countFilterOf({ variantIds: Array.from({ length: 1001 }, variant) }),
        ),
      ).toEqual({ field: 'variantIds', code: 'arrayLength' });
      expect(
        fieldOf(() => countFilterOf({ variantIds: [ids[0], ids[1], ids[0]] })),
      ).toEqual({ field: 'variantIds[2]', code: 'duplicateVariant' });
    });

    it('needs something to take lines from', () => {
      expect(fieldOf(() => countFilterOf({}))).toEqual({
        field: 'location',
        code: 'countFilter',
      });
    });

    it.each(['', '*', ' * ', `${'X'.repeat(21)}*`])(
      'rejects the location %j',
      (location) => {
        expect(() => countFilterOf({ location })).toThrow(InvalidLocationError);
      },
    );
  });

  it('matches a pattern exactly or by its prefix', () => {
    expect(locationMatch('A1')).toEqual({ location: 'A1' });
    expect(locationMatch('A*')).toEqual({ locationPrefix: 'A' });
  });

  it('counts from 0 to 100,000 units', () => {
    expect(countedOf(0)).toBe(0);
    expect(countedOf(100_000)).toBe(100_000);
    for (const counted of [-1, 100_001, 1.5, Number.NaN]) {
      expect(fieldOf(() => countedOf(counted))).toEqual({
        field: 'counted',
        code: 'range',
      });
    }
  });

  it('formats the folio with at least six digits', () => {
    expect(formatCountFolio(123)).toBe('C-000123');
    expect(formatCountFolio(1_234_567)).toBe('C-1234567');
  });

  it('takes the difference as counted minus the units then, and none until it is counted', () => {
    const line: CountLine = {
      variantId: variant(),
      position: 1,
      location: null,
      counted: null,
      expected: null,
      countedBy: null,
      countedAt: null,
      recount: false,
      outcome: null,
      movementId: null,
    };
    expect(differenceOf(line)).toBeNull();
    expect(differenceOf({ ...line, counted: 3, expected: 5 })).toBe(-2);
    expect(differenceOf({ ...line, counted: 5, expected: 5 })).toBe(0);
  });

  describe('StockCount', () => {
    const open = (note?: string | null) =>
      StockCount.open({
        id: newId<'StockCount'>(),
        warehouseId: toId<'Warehouse'>(newId()),
        filter: { countClass: 'A' },
        note,
        staffId: 'staff',
        now: NOW,
      });

    it('opens with its filter and a trimmed note, at version 1', () => {
      const count = open('  semanal ');
      expect(count.snapshot).toMatchObject({
        number: null,
        filter: { countClass: 'A' },
        note: 'semanal',
        status: 'OPEN',
        createdBy: 'staff',
        createdAt: NOW,
        closedBy: null,
        closedAt: null,
        version: 1,
      });
      expect(open('   ').snapshot.note).toBeNull();
      expect(() => open('x'.repeat(501))).toThrow(InvalidValueError);
    });

    it('is applied or cancelled once, and then its lines never change', () => {
      const applied = open();
      applied.changeLines('count');
      applied.apply('boss', NOW);
      expect(applied.snapshot).toMatchObject({
        status: 'APPLIED',
        closedBy: 'boss',
        closedAt: NOW,
      });
      expect(() => applied.changeLines('count')).toThrow(
        InvalidStateTransitionError,
      );
      expect(() => applied.cancel('boss', NOW)).toThrow(
        InvalidStateTransitionError,
      );

      const cancelled = open();
      cancelled.cancel('boss', NOW);
      expect(cancelled.snapshot.status).toBe('CANCELLED');
      expect(() => cancelled.changeLines('recount')).toThrow(
        InvalidStateTransitionError,
      );
      expect(() => cancelled.apply('boss', NOW)).toThrow(
        InvalidStateTransitionError,
      );
    });
  });
});
