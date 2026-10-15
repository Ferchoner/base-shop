import {
  csvFileError,
  readCsvFile,
  type UploadedCsvFile,
} from '../../../platform/files/csv-file.js';
import { CsvFileUpload } from '../../../platform/files/csv-upload.js';
import {
  MAX_OPTION_COLUMN_NAME_LENGTH,
  MAX_PRODUCT_FILE_BYTES,
  MAX_PRODUCT_IMPORT_ROWS,
  OPTION_COLUMN_PREFIX,
  OPTIONAL_PRODUCT_COLUMNS,
  type ProductImportRow,
  REQUIRED_PRODUCT_COLUMNS,
} from '../application/product-import.js';

/** An endpoint that receives one product file, of up to 5 MB, in the `file` field of a `multipart/form-data` body. */
export function ProductFileUpload(): MethodDecorator {
  return CsvFileUpload(MAX_PRODUCT_FILE_BYTES);
}

/**
 * The rows of a product file (ADR-0164): a UTF-8 CSV, with or without a byte order mark, whose header names its
 * columns in any order and whatever their case, with a column `option:<nombre>` for each option. Each row keeps its
 * line in the file and its cells trimmed; checking their values is the import's job, so every error of a row is
 * answered at once.
 *
 * @throws ProblemException 400 `validation-error` on `file` when there is no file, or it is not a UTF-8 CSV with
 * those columns and between 1 and 5,000 rows.
 */
export function readProductFile(
  file: UploadedCsvFile | undefined,
): ProductImportRow[] {
  const read = readCsvFile(file, {
    required: REQUIRED_PRODUCT_COLUMNS,
    optional: OPTIONAL_PRODUCT_COLUMNS,
    prefix: OPTION_COLUMN_PREFIX,
    maxRows: MAX_PRODUCT_IMPORT_ROWS,
    noRows: 'No tiene filas de productos.',
  });
  const long = read.prefixed.find(
    (name) => name.length > MAX_OPTION_COLUMN_NAME_LENGTH,
  );
  if (long !== undefined) {
    throw csvFileError(
      'columns',
      `El nombre de la opción ${long} debe tener hasta ${MAX_OPTION_COLUMN_NAME_LENGTH} caracteres.`,
    );
  }
  return read.rows.map(({ line, wellFormed, cells, prefixed }) => ({
    line,
    wellFormed,
    slug: cells.slug,
    title: cells.title,
    description: cells.description,
    brand: cells.brand,
    categories: cells.categories,
    sku: cells.sku,
    gtin: cells.gtin,
    weightGrams: cells.weightGrams,
    lengthCm: cells.lengthCm,
    widthCm: cells.widthCm,
    heightCm: cells.heightCm,
    storeOnly: cells.storeOnly,
    options: prefixed,
  }));
}
