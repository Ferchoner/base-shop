import {
  FileImportError,
  type ImportRowError,
  ImportRowErrors,
} from '../../../shared-kernel/index.js';
import { MAX_STOCK_QUANTITY } from '../domain/stock.js';

/** Most rows a bulk import of receipts takes (ADR-0164). */
export const MAX_RECEIPT_IMPORT_ROWS = 5_000;

/** Largest file a bulk import of receipts takes: 1 MB, like the prices (ADR-0164). */
export const MAX_RECEIPT_FILE_BYTES = 1_048_576;

/** Columns the file must have, in any order (ADR-0164). */
export const REQUIRED_RECEIPT_COLUMNS = [
  'sku',
  'warehouse',
  'quantity',
] as const;

/** Columns the file may have, in any order (ADR-0164). */
export const OPTIONAL_RECEIPT_COLUMNS = ['note'] as const;

/** Most units a stock item holds: `on_hand` is an `integer` (DATABASE.md §6.2). */
export const MAX_ON_HAND = 2_147_483_647;

/** A row of the file as read, with its line in the file (the header is line 1) and its cells trimmed. */
export interface ReceiptImportRow {
  readonly line: number;
  /** False when the row has another number of cells than the header. */
  readonly wellFormed: boolean;
  readonly sku: string;
  /** The code of the warehouse. */
  readonly warehouse: string;
  readonly quantity: string;
  readonly note: string;
}

/** A file of receipts as the import takes it: its rows, and the SHA-256 of its bytes, in lowercase hexadecimal. */
export interface ReceiptFile {
  readonly rows: readonly ReceiptImportRow[];
  readonly sha256: string;
}

/** What an import did, or would do with `dryRun`. */
export interface ReceiptImportSummary {
  readonly rows: number;
  /** Units received, the sum of the quantities. */
  readonly units: number;
  readonly dryRun: boolean;
}

/**
 * The file of receipts has errors, so nothing was imported (ADR-0164). Answered 400 `validation-error` with the
 * first errors by line.
 */
export class ReceiptImportError extends FileImportError {
  constructor(errors: readonly ImportRowError[]) {
    super(errors, 'The receipt file has errors');
  }
}

/** The errors of the rows of a file of receipts, kept in the order of their lines. */
export class ReceiptRowErrors extends ImportRowErrors {
  /** @returns ReceiptImportError. */
  protected override errorFor(
    errors: readonly ImportRowError[],
  ): ReceiptImportError {
    return new ReceiptImportError(errors);
  }
}

const UNITS = /^\d{1,6}$/;

/** A whole number of units from 1 to 100,000, such as `25`; `null` for anything else, such as `2.5` or `0`. */
export function unitsFrom(text: string): number | null {
  if (!UNITS.test(text)) return null;
  const units = Number(text);
  return units >= 1 && units <= MAX_STOCK_QUANTITY ? units : null;
}
