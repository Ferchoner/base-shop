import {
  applyDecorators,
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  PayloadTooLargeException,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes } from '@nestjs/swagger';
import { catchError, type Observable, throwError } from 'rxjs';
import { MalformedCsvError, parseCsv } from '../../../platform/files/csv.js';
import { ProblemException } from '../../../platform/http/problem-details/problem.exception.js';
import {
  MAX_PRICE_FILE_BYTES,
  MAX_PRICE_IMPORT_ROWS,
  PRICE_FILE_COLUMNS,
  type PriceImportRow,
} from '../application/price-import.js';

/** Multipart field that carries the file (API_SPEC.md §12). */
export const PRICE_FILE_FIELD = 'file';

/** The file part of a multipart request, as multer keeps it in memory. */
export interface UploadedPriceFile {
  readonly buffer: Buffer;
}

/** A 400 `validation-error` on the `file` field. */
function fileError(code: string, message: string): ProblemException {
  return new ProblemException('validation-error', {
    errors: [{ field: PRICE_FILE_FIELD, code, message }],
  });
}

/**
 * Answers the 413 of multer as API_SPEC.md §6.2 asks, with `maxBytes`: multer cuts the upload as soon as it
 * passes 1 MB, before the rest is read (ADR-0126).
 */
@Injectable()
export class PriceFileLimit implements NestInterceptor {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: unknown) =>
        throwError(() =>
          error instanceof PayloadTooLargeException
            ? new ProblemException('payload-too-large', {
                maxBytes: MAX_PRICE_FILE_BYTES,
              })
            : error,
        ),
      ),
    );
  }
}

/** An endpoint that receives one price file, in memory, in the `file` field of a `multipart/form-data` body. */
export function PriceFileUpload(): MethodDecorator {
  return applyDecorators(
    // The first one wraps the second, so it sees the errors of multer.
    UseInterceptors(
      PriceFileLimit,
      FileInterceptor(PRICE_FILE_FIELD, {
        limits: {
          fileSize: MAX_PRICE_FILE_BYTES,
          files: 1,
          fields: 0,
          parts: 1,
        },
      }),
    ),
    ApiConsumes('multipart/form-data'),
  );
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
  file: UploadedPriceFile | undefined,
): PriceImportRow[] {
  if (file === undefined) throw fileError('isDefined', 'Es obligatorio.');
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(file.buffer);
  } catch {
    throw fileError('utf8', 'Debe estar en UTF-8.');
  }
  let records;
  try {
    // TextDecoder already drops a byte order mark, as spreadsheets write at the start of a UTF-8 CSV.
    records = parseCsv(text);
  } catch (error) {
    if (!(error instanceof MalformedCsvError)) throw error;
    throw fileError(
      'csv',
      'No es un CSV válido: termina dentro de un valor entre comillas.',
    );
  }
  const [header, ...rows] = records;
  if (header === undefined) {
    throw fileError('emptyFile', 'No tiene filas de precios.');
  }
  const columns = header.fields.map((name) => name.trim().toLowerCase());
  const positions = PRICE_FILE_COLUMNS.map((column) =>
    columns.indexOf(column.toLowerCase()),
  );
  if (columns.length !== PRICE_FILE_COLUMNS.length || positions.includes(-1)) {
    throw fileError(
      'columns',
      `Debe tener una vez cada columna: ${PRICE_FILE_COLUMNS.join(', ')}.`,
    );
  }
  if (rows.length === 0) {
    throw fileError('emptyFile', 'No tiene filas de precios.');
  }
  if (rows.length > MAX_PRICE_IMPORT_ROWS) {
    throw fileError(
      'tooManyRows',
      `Tiene más de ${MAX_PRICE_IMPORT_ROWS.toLocaleString('en-US')} filas.`,
    );
  }
  const [sku, amount, compareAtAmount, effectiveFrom] = positions;
  return rows.map(({ line, fields }) => {
    const cell = (position: number) => (fields[position] ?? '').trim();
    return {
      line,
      wellFormed: fields.length === columns.length,
      sku: cell(sku),
      amount: cell(amount),
      compareAtAmount: cell(compareAtAmount),
      effectiveFrom: cell(effectiveFrom),
    };
  });
}
