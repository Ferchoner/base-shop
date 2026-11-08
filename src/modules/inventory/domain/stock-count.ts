import {
  DomainError,
  type Id,
  InvalidStateTransitionError,
  InvalidValueError,
} from '../../../shared-kernel/index.js';
import {
  locationOf,
  MAX_NOTE_LENGTH,
  MAX_STOCK_QUANTITY,
  noteOf,
  type StockMovementId,
  type VariantId,
} from './stock.js';
import type { WarehouseId } from './warehouse.js';

export type StockCountId = Id<'StockCount'>;

/** `OPEN` while it is counted; `APPLIED` once its differences are adjusted, or `CANCELLED` (ADR-0173). */
export type CountStatus = 'OPEN' | 'APPLIED' | 'CANCELLED';

export const COUNT_STATUSES: readonly CountStatus[] = [
  'OPEN',
  'APPLIED',
  'CANCELLED',
];

/**
 * What applying a sheet did with a line (ADR-0173): adjusted by its difference, nothing because it had none, nothing
 * because it was not counted, or nothing because the adjustment would leave fewer units on hand than reserved.
 */
export type CountOutcome =
  'ADJUSTED' | 'NO_DIFFERENCE' | 'NOT_COUNTED' | 'SKIPPED_RESERVED';

export const COUNT_OUTCOMES: readonly CountOutcome[] = [
  'ADJUSTED',
  'NO_DIFFERENCE',
  'NOT_COUNTED',
  'SKIPPED_RESERVED',
];

/** The class of a product to count, from Catalog (ADR-0173). */
export type CountClass = 'A' | 'B' | 'C';

export const COUNT_CLASSES: readonly CountClass[] = ['A', 'B', 'C'];

/** Most lines of one sheet, so applying it stays one short transaction (ADR-0173). */
export const MAX_COUNT_LINES = 1_000;

/** Most units counted in a line, like the largest receipt (ADR-0071). */
export const MAX_COUNTED = MAX_STOCK_QUANTITY;

/**
 * What a sheet takes its lines from (ADR-0173): a location, exact or a prefix with `*` at the end, a category, a
 * class, or any of those together; or else a list of variants, alone.
 */
export interface CountFilter {
  /** Kept in upper case, with its `*` when it is a prefix. */
  readonly location?: string;
  readonly categoryId?: string;
  readonly countClass?: CountClass;
  readonly variantIds?: readonly VariantId[];
}

/** A line of a sheet as it is kept. */
export interface CountLine {
  readonly variantId: VariantId;
  /** Its order on the sheet: by location and then SKU when it was opened; one added later goes last. */
  readonly position: number;
  /** The location of the stock item when the line was taken. */
  readonly location: string | null;
  /** What was counted; `null` until then, and again when a recount is asked. */
  readonly counted: number | null;
  /** The units on hand when it was counted: the difference is `counted - expected`. */
  readonly expected: number | null;
  readonly countedBy: string | null;
  readonly countedAt: Date | null;
  /** The staff asked to count it again. */
  readonly recount: boolean;
  /** What applying the sheet did with it; `null` until then. */
  readonly outcome: CountOutcome | null;
  /** The PHYSICAL_COUNT adjustment of an ADJUSTED line. */
  readonly movementId: StockMovementId | null;
}

/** A sheet without its lines, as it is locked to change it. */
export interface StockCountSnapshot {
  readonly id: StockCountId;
  /** The consecutive number of its folio, from the database; `null` until it is saved. */
  readonly number: number | null;
  readonly warehouseId: WarehouseId;
  readonly filter: CountFilter;
  readonly note: string | null;
  readonly status: CountStatus;
  readonly createdBy: string;
  readonly createdAt: Date;
  /** Who applied or cancelled it, and when. */
  readonly closedBy: string | null;
  readonly closedAt: Date | null;
  readonly version: number;
}

/** A value of a sheet the API answers as a validation error of one field. */
export class CountFieldError extends DomainError {
  readonly code = 'validation-error';
  readonly category = 'invalid';

  constructor(field: string, code: string, message: string) {
    super(`${field}: ${code}`, { errors: [{ field, code, message }] });
  }
}

/** A variant that is already in another open sheet of the warehouse, and that sheet. */
export interface OpenCountLine {
  readonly variantId: VariantId;
  readonly countId: StockCountId;
  readonly folio: string;
}

/** A variant is in one open sheet per warehouse (ADR-0173). Answered 409 with those variants and their sheets. */
export class VariantInOpenCountError extends DomainError {
  readonly code = 'variant-in-open-count';
  readonly category = 'conflict';

  constructor(lines: readonly OpenCountLine[]) {
    super('Some variants are in another open count sheet of the warehouse', {
      lines,
    });
  }
}

/** At least six digits, like the folios of transfers (ADR-0172). */
const MIN_DIGITS = 6;

/** The folio of a sheet: `C-` and its number with at least six digits. */
export function formatCountFolio(number: number): string {
  return `C-${String(number).padStart(MIN_DIGITS, '0')}`;
}

/**
 * The filter of a new sheet.
 *
 * @throws CountFieldError when it has nothing to take lines from (`countFilter`), or a list of variants goes with
 *   anything else (`variantIdsAlone`), is empty or longer than 1,000 (`arrayLength`), or repeats one
 *   (`duplicateVariant`).
 * @throws InvalidLocationError for a location, or the prefix before its `*`, that is blank or longer than 20
 *   characters.
 */
export function countFilterOf(filter: CountFilter): CountFilter {
  const { variantIds, location, categoryId, countClass } = filter;
  const others = [location, categoryId, countClass].some(
    (value) => value !== undefined,
  );
  if (variantIds === undefined) {
    if (!others) {
      throw new CountFieldError(
        'location',
        'countFilter',
        'Indica una ubicación, una categoría, una clase o una lista de variantes.',
      );
    }
    return {
      ...(location === undefined
        ? {}
        : { location: locationPattern(location) }),
      ...(categoryId === undefined ? {} : { categoryId }),
      ...(countClass === undefined ? {} : { countClass }),
    };
  }
  if (others) {
    throw new CountFieldError(
      'variantIds',
      'variantIdsAlone',
      'Una lista de variantes no se combina con otro filtro.',
    );
  }
  if (variantIds.length === 0 || variantIds.length > MAX_COUNT_LINES) {
    throw new CountFieldError(
      'variantIds',
      'arrayLength',
      `Debe tener de 1 a ${MAX_COUNT_LINES.toLocaleString('en-US')} variantes.`,
    );
  }
  const seen = new Set<VariantId>();
  variantIds.forEach((variantId, i) => {
    if (seen.has(variantId)) {
      throw new CountFieldError(
        `variantIds[${i}]`,
        'duplicateVariant',
        'Cada variante va una vez por hoja.',
      );
    }
    seen.add(variantId);
  });
  return { variantIds };
}

/** A location, or a prefix with `*` at the end, as it is kept: the location part as `locationOf` keeps it. */
function locationPattern(location: string): string {
  const text = location.trim();
  return text.endsWith('*')
    ? `${locationOf(text.slice(0, -1))}*`
    : locationOf(text);
}

/** The location of a stock filter for a pattern of `countFilterOf`: exact, or a prefix. */
export function locationMatch(
  pattern: string,
): { location: string } | { locationPrefix: string } {
  return pattern.endsWith('*')
    ? { locationPrefix: pattern.slice(0, -1) }
    : { location: pattern };
}

/**
 * The units counted in a line: 0 to 100,000.
 *
 * @throws CountFieldError for any other number.
 */
export function countedOf(counted: number): number {
  if (!Number.isInteger(counted) || counted < 0 || counted > MAX_COUNTED) {
    throw new CountFieldError(
      'counted',
      'range',
      `Debe ser de 0 a ${MAX_COUNTED.toLocaleString('en-US')}.`,
    );
  }
  return counted;
}

/** What was counted minus what there was then; `null` until it is counted. */
export function differenceOf(line: CountLine): number | null {
  return line.counted === null || line.expected === null
    ? null
    : line.counted - line.expected;
}

/**
 * A count sheet (T-166, ADR-0173): variants of one warehouse that are counted, blind, reviewed and adjusted at once.
 * This is its header; its lines change through the repository while it is OPEN, and each change counts one more
 * version, so the review always applies what it read. An applied or cancelled sheet never changes again.
 */
export class StockCount {
  private constructor(private state: StockCountSnapshot) {}

  /**
   * A new open sheet; its lines are taken by the caller.
   *
   * @throws CountFieldError for a filter `countFilterOf` does not allow.
   * @throws InvalidValueError for a note longer than 500 characters.
   */
  static open(input: {
    id: StockCountId;
    warehouseId: WarehouseId;
    filter: CountFilter;
    note?: string | null;
    staffId: string;
    now: Date;
  }): StockCount {
    const note = noteOf(input.note);
    if (note !== null && note.length > MAX_NOTE_LENGTH) {
      throw new InvalidValueError(
        `A note has at most ${MAX_NOTE_LENGTH} characters`,
      );
    }
    return new StockCount({
      id: input.id,
      number: null,
      warehouseId: input.warehouseId,
      filter: countFilterOf(input.filter),
      note,
      status: 'OPEN',
      createdBy: input.staffId,
      createdAt: input.now,
      closedBy: null,
      closedAt: null,
      version: 1,
    });
  }

  static restore(snapshot: StockCountSnapshot): StockCount {
    return new StockCount(snapshot);
  }

  get snapshot(): StockCountSnapshot {
    return this.state;
  }

  get id(): StockCountId {
    return this.state.id;
  }

  get version(): number {
    return this.state.version;
  }

  /**
   * Checks that a line can change: counted, added or asked to be counted again.
   *
   * @throws InvalidStateTransitionError when the sheet is not OPEN.
   */
  changeLines(action: 'count' | 'recount'): void {
    this.requireOpen(action);
  }

  /**
   * Applies it; the caller adjusts its lines in the same transaction.
   *
   * @throws InvalidStateTransitionError when it is not OPEN.
   */
  apply(staffId: string, now: Date): void {
    this.close('APPLIED', 'apply', staffId, now);
  }

  /**
   * Cancels it, with nothing adjusted.
   *
   * @throws InvalidStateTransitionError when it is not OPEN.
   */
  cancel(staffId: string, now: Date): void {
    this.close('CANCELLED', 'cancel', staffId, now);
  }

  private close(
    status: CountStatus,
    action: string,
    staffId: string,
    now: Date,
  ): void {
    this.requireOpen(action);
    this.state = { ...this.state, status, closedBy: staffId, closedAt: now };
  }

  private requireOpen(action: string): void {
    if (this.state.status !== 'OPEN') {
      throw new InvalidStateTransitionError(this.state.status, action);
    }
  }
}
