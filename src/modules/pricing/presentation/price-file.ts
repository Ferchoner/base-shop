import {
  readCsvFile,
  type UploadedCsvFile,
} from '../../../platform/files/csv-file.js';
import { CsvFileUpload } from '../../../platform/files/csv-upload.js';
import {
  MAX_PRICE_FILE_BYTES,
  MAX_PRICE_IMPORT_ROWS,
  PRICE_FILE_COLUMNS,
  type PriceImportRow,
} from '../application/price-import.js';

/** An endpoint that receives one price file, of up to 1 MB, in the `file` field of a `multipart/form-data` body. */
export function PriceFileUpload(): MethodDecorator {
  return CsvFileUpload(MAX_PRICE_FILE_BYTES);
}

/**
 * The rows of a price file (ADR-0126): a UTF-8 CSV, with or without a byte order mark, whose header names the
 * four columns in any order and whatever their case. Each row keeps its line in the file and its cells
 * trimmed; checking their values is the import's job, so every error of a row is answered at once.
 *
 * @throws ProblemException 400 `validation-error` on `file` when there is no file, or it is not a UTF-8 CSV
 * with those columns and between 1 and 5,000 rows.
 */
export function readPriceFile(
  file: UploadedCsvFile | undefined,
): PriceImportRow[] {
  const { rows } = readCsvFile(file, {
    required: PRICE_FILE_COLUMNS,
    maxRows: MAX_PRICE_IMPORT_ROWS,
    noRows: 'No tiene filas de precios.',
  });
  return rows.map(({ line, wellFormed, cells }) => ({
    line,
    wellFormed,
    sku: cells.sku,
    amount: cells.amount,
    compareAtAmount: cells.compareAtAmount,
    effectiveFrom: cells.effectiveFrom,
  }));
}
