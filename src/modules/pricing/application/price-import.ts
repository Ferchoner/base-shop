import { DomainError, MAX_MONEY_AMOUNT } from '../../../shared-kernel/index.js';

/** Most rows a bulk import takes (ADR-0126). */
export const MAX_PRICE_IMPORT_ROWS = 5_000;

/** Largest file a bulk import takes: 1 MB (ADR-0126). */
export const MAX_PRICE_FILE_BYTES = 1_048_576;

/** Most row errors an answer lists, the first ones by line (ADR-0126). */
export const MAX_PRICE_IMPORT_ERRORS = 100;

/** The columns of the file, in any order (ADR-0126). */
export const PRICE_FILE_COLUMNS = [
  'sku',
  'amount',
  'compareAtAmount',
  'effectiveFrom',
] as const;

/**
 * Time zone of a date and time without an offset: Mexico's, as for the jobs (ADR-0101, ADR-0126), whatever
 * the time zone of the server.
 */
export const BUSINESS_TIME_ZONE = 'America/Mexico_City';

/** A row of the file as read, with its line in the file (the header is line 1) and its cells trimmed. */
export interface PriceImportRow {
  readonly line: number;
  /** False when the row has another number of cells than the header. */
  readonly wellFormed: boolean;
  readonly sku: string;
  readonly amount: string;
  readonly compareAtAmount: string;
  readonly effectiveFrom: string;
}

/** What an import did, or would do with `dryRun`. */
export interface PriceImportSummary {
  readonly rows: number;
  /** Periods opened or scheduled. */
  readonly created: number;
  /** Rows equal to the current price, or to a price already scheduled at the same instant. */
  readonly unchanged: number;
  readonly dryRun: boolean;
}

/** One error of a row, with its path as `rows[<line>].<column>` (API_SPEC.md §6.1). */
export interface PriceRowError {
  readonly field: string;
  readonly code: string;
  readonly message: string;
}

/**
 * The file has errors, so nothing was imported (ADR-0126). Answered 400 `validation-error` with the first
 * errors by line.
 */
export class PriceImportError extends DomainError {
  readonly code = 'validation-error';
  readonly category = 'invalid';

  constructor(errors: readonly PriceRowError[]) {
    super('The price file has errors', {
      errors: errors.slice(0, MAX_PRICE_IMPORT_ERRORS),
    });
  }
}

/** The errors of the rows of a file, kept in the order of their lines. */
export class PriceRowErrors {
  private readonly errors: { line: number; error: PriceRowError }[] = [];

  /** An error of a cell, or of the whole row without `column`. */
  add(line: number, column: string | null, code: string, message: string) {
    const field = column === null ? `rows[${line}]` : `rows[${line}].${column}`;
    this.errors.push({ line, error: { field, code, message } });
  }

  /** @throws PriceImportError when there is any error. */
  throwIfAny(): void {
    if (this.errors.length === 0) return;
    throw new PriceImportError(
      [...this.errors]
        .sort((a, b) => a.line - b.line)
        .map(({ error }) => error),
    );
  }
}

const PESOS = /^\d{1,9}(\.\d{1,2})?$/;

/**
 * The cents of an amount in pesos with a decimal point and up to 2 decimals, such as `599`, `599.5` or
 * `599.00`; `null` for anything else, such as `$599`, `1,599.00` or more than the largest amount.
 */
export function centsFromPesos(text: string): number | null {
  if (!PESOS.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return cents <= MAX_MONEY_AMOUNT ? cents : null;
}

const WITH_OFFSET =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const WITHOUT_OFFSET =
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * The instant of a date and time: ISO 8601 with an offset (`2026-11-14T06:00:00Z`), or without one in
 * Mexico's time (`2026-11-14 00:00`). `null` for anything else, or a date that does not exist.
 */
export function instantFrom(text: string): Date | null {
  const withOffset = WITH_OFFSET.exec(text);
  if (withOffset !== null) {
    const instant = new Date(text);
    return wallTime(withOffset) !== null && !Number.isNaN(instant.getTime())
      ? instant
      : null;
  }
  const withoutOffset = WITHOUT_OFFSET.exec(text);
  const wall = withoutOffset === null ? null : wallTime(withoutOffset);
  return wall === null ? null : new Date(wall - mexicoOffset(wall));
}

/** The date and time of a match as if in UTC, or `null` when it does not exist, such as February 30. */
function wallTime(match: RegExpExecArray): number | null {
  const [year, month, day, hour, minute, second = 0] = match
    .slice(1, 7)
    .map((part) => (part === undefined ? undefined : Number(part)));
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined
  ) {
    return null;
  }
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(wall);
  // A value out of range rolls over into the next part, such as February 30 into March 2 or 24:00 into the
  // next day, so the date and time exist only if every part comes back as it was.
  const parts = [
    check.getUTCFullYear(),
    check.getUTCMonth() + 1,
    check.getUTCDate(),
    check.getUTCHours(),
    check.getUTCMinutes(),
    check.getUTCSeconds(),
  ];
  return parts.every(
    (part, index) => part === [year, month, day, hour, minute, second][index],
  )
    ? wall
    : null;
}

const MEXICO = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
});

/**
 * How far Mexico's time is from UTC for a date and time there, in milliseconds (negative: behind). Asked
 * twice, so a date in the summer time Mexico had until 2022 gets that time's offset.
 */
function mexicoOffset(wall: number): number {
  const first = offsetAt(wall);
  return offsetAt(wall - first);
}

function offsetAt(instant: number): number {
  const parts = Object.fromEntries(
    MEXICO.formatToParts(new Date(instant)).map(({ type, value }) => [
      type,
      Number(value),
    ]),
  );
  const there = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return there - instant;
}
