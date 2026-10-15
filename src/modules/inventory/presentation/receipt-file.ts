import { createHash } from 'node:crypto';
import {
  readCsvFile,
  type UploadedCsvFile,
} from '../../../platform/files/csv-file.js';
import { CsvFileUpload } from '../../../platform/files/csv-upload.js';
import {
  MAX_RECEIPT_FILE_BYTES,
  MAX_RECEIPT_IMPORT_ROWS,
  OPTIONAL_RECEIPT_COLUMNS,
  type ReceiptFile,
  REQUIRED_RECEIPT_COLUMNS,
} from '../application/receipt-import.js';

/** An endpoint that receives one file of receipts, of up to 1 MB, in the `file` field of a `multipart/form-data` body. */
export function ReceiptFileUpload(): MethodDecorator {
  return CsvFileUpload(MAX_RECEIPT_FILE_BYTES);
}

/**
 * The rows of a file of receipts (ADR-0164), and the SHA-256 of its bytes, which tells a file already imported: a
 * UTF-8 CSV, with or without a byte order mark, whose header names its columns in any order and whatever their
 * case. Each row keeps its line in the file and its cells trimmed; checking their values is the import's job, so
 * every error of a row is answered at once.
 *
 * @throws ProblemException 400 `validation-error` on `file` when there is no file, or it is not a UTF-8 CSV with
 * those columns and between 1 and 5,000 rows.
 */
export function readReceiptFile(
  file: UploadedCsvFile | undefined,
): ReceiptFile {
  const { rows } = readCsvFile(file, {
    required: REQUIRED_RECEIPT_COLUMNS,
    optional: OPTIONAL_RECEIPT_COLUMNS,
    maxRows: MAX_RECEIPT_IMPORT_ROWS,
    noRows: 'No tiene filas de entradas.',
  });
  return {
    sha256: createHash('sha256').update(file!.buffer).digest('hex'),
    rows: rows.map(({ line, wellFormed, cells }) => ({
      line,
      wellFormed,
      sku: cells.sku,
      warehouse: cells.warehouse,
      quantity: cells.quantity,
      note: cells.note,
    })),
  };
}
