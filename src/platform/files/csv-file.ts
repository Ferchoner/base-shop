import { ProblemException } from '../http/problem-details/problem.exception.js';
import { type CsvRecord, MalformedCsvError, parseCsv } from './csv.js';

/** Multipart field that carries the file of a bulk import (ADR-0126, ADR-0164). */
export const CSV_FILE_FIELD = 'file';

/** The file part of a multipart request, as multer keeps it in memory. */
export interface UploadedCsvFile {
  readonly buffer: Buffer;
}

/** The columns a file of a bulk import has, matched whatever their case and the spaces around them. */
export interface CsvFileSpec {
  /** Columns the header must have, once each. */
  readonly required: readonly string[];
  /** Columns the header may have, once each. */
  readonly optional?: readonly string[];
  /** Columns named with this prefix, as many as the file needs, each once: `option:` for `option:talla`. */
  readonly prefix?: string;
  /** Most rows after the header. */
  readonly maxRows: number;
  /** What `emptyFile` says, such as "No tiene filas de precios.". */
  readonly noRows: string;
}

/** A row of the file, with its line (the header is line 1) and its cells trimmed. */
export interface CsvFileRow {
  readonly line: number;
  /** False when the row has another number of cells than the header. */
  readonly wellFormed: boolean;
  /** The cell of each required and optional column, by its name in the spec; '' when the file has not the column. */
  readonly cells: Readonly<Record<string, string>>;
  /** The cells of the prefixed columns, by the name after the prefix, trimmed and in lowercase. */
  readonly prefixed: Readonly<Record<string, string>>;
}

/** The rows of a file, and the names of its prefixed columns in the order of the header. */
export interface CsvFile {
  readonly rows: readonly CsvFileRow[];
  readonly prefixed: readonly string[];
}

/** A 400 `validation-error` on the `file` field. */
export function csvFileError(code: string, message: string): ProblemException {
  return new ProblemException('validation-error', {
    errors: [{ field: CSV_FILE_FIELD, code, message }],
  });
}

/**
 * The rows of the file of a bulk import (ADR-0126, ADR-0164): a UTF-8 CSV, with or without a byte order mark, whose
 * header names its columns in any order and whatever their case. Each row keeps its line in the file and its cells
 * trimmed; checking their values is the import's job, so every error of a row is answered at once.
 *
 * @throws ProblemException 400 `validation-error` on `file` when there is no file, or it is not a UTF-8 CSV with
 * the columns of the spec and between 1 and `maxRows` rows.
 */
export function readCsvFile(
  file: UploadedCsvFile | undefined,
  spec: CsvFileSpec,
): CsvFile {
  if (file === undefined) throw csvFileError('isDefined', 'Es obligatorio.');
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(file.buffer);
  } catch {
    throw csvFileError('utf8', 'Debe estar en UTF-8.');
  }
  let records: CsvRecord[];
  try {
    // TextDecoder already drops a byte order mark, as spreadsheets write at the start of a UTF-8 CSV.
    records = parseCsv(text);
  } catch (error) {
    if (!(error instanceof MalformedCsvError)) throw error;
    throw csvFileError(
      'csv',
      'No es un CSV válido: termina dentro de un valor entre comillas.',
    );
  }
  const [header, ...rows] = records;
  if (header === undefined) throw csvFileError('emptyFile', spec.noRows);
  const columns = columnsOf(header.fields, spec);
  if (rows.length === 0) throw csvFileError('emptyFile', spec.noRows);
  if (rows.length > spec.maxRows) {
    throw csvFileError(
      'tooManyRows',
      `Tiene más de ${spec.maxRows.toLocaleString('en-US')} filas.`,
    );
  }
  const named = [...spec.required, ...(spec.optional ?? [])];
  return {
    prefixed: columns.flatMap((column) =>
      column.prefixed ? [column.name] : [],
    ),
    rows: rows.map(({ line, fields }) => {
      const cells: Record<string, string> = Object.fromEntries(
        named.map((name) => [name, '']),
      );
      const prefixed: Record<string, string> = {};
      columns.forEach((column, position) => {
        const cell = (fields[position] ?? '').trim();
        if (column.prefixed) prefixed[column.name] = cell;
        else cells[column.name] = cell;
      });
      return {
        line,
        wellFormed: fields.length === columns.length,
        cells,
        prefixed,
      };
    }),
  };
}

/** A column of the header: the name of the spec, or the name after the prefix. */
interface Column {
  readonly name: string;
  readonly prefixed: boolean;
}

/** @throws ProblemException `columns` for a column that is missing, unknown or repeated. */
function columnsOf(header: readonly string[], spec: CsvFileSpec): Column[] {
  const named = [...spec.required, ...(spec.optional ?? [])];
  const prefix = spec.prefix?.toLowerCase();
  const seen = new Set<string>();
  const columns = header.map((raw): Column => {
    const text = raw.trim();
    const lower = text.toLowerCase();
    const known = named.find((name) => name.toLowerCase() === lower);
    let column: Column;
    if (known !== undefined) {
      column = { name: known, prefixed: false };
    } else if (prefix !== undefined && lower.startsWith(prefix)) {
      column = { name: lower.slice(prefix.length).trim(), prefixed: true };
      if (column.name === '') {
        throw columnsError(spec, `La columna ${text} no tiene nombre.`);
      }
    } else {
      throw columnsError(
        spec,
        text === ''
          ? 'Tiene una columna sin nombre.'
          : `No reconoce la columna ${text}.`,
      );
    }
    const key = `${column.prefixed ? prefix : ''}${column.name}`;
    if (seen.has(key)) {
      throw columnsError(spec, `Repite la columna ${text}.`);
    }
    seen.add(key);
    return column;
  });
  const missing = spec.required.find((name) => !seen.has(name));
  if (missing !== undefined) {
    throw columnsError(spec, `Le falta la columna ${missing}.`);
  }
  return columns;
}

function columnsError(spec: CsvFileSpec, problem: string): ProblemException {
  const optional = [
    ...(spec.optional ?? []),
    ...(spec.prefix === undefined ? [] : [`${spec.prefix}<nombre>`]),
  ];
  return csvFileError(
    'columns',
    `Debe tener una vez cada columna: ${spec.required.join(', ')}.` +
      (optional.length === 0
        ? ''
        : ` Puede tener también, una vez cada una: ${optional.join(', ')}.`) +
      ` ${problem}`,
  );
}
