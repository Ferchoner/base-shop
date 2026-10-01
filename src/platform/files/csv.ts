/** A record of a CSV file and the line of the file where it begins, from 1 (the header, if it has one). */
export interface CsvRecord {
  readonly line: number;
  readonly fields: string[];
}

/** The text ends inside a quoted field, so it is not a CSV. */
export class MalformedCsvError extends Error {}

/**
 * RFC 4180 CSV (ADR-0109, ADR-0126): comma-separated fields, optionally in double quotes, where a quoted
 * field may hold commas, line breaks and doubled quotes. Accepts LF and CRLF line ends and skips empty
 * lines, but counts them, so each record keeps the line where it begins. A byte order mark is the caller's
 * to remove.
 *
 * @throws MalformedCsvError when the text ends inside a quoted field.
 */
export function parseCsv(text: string): CsvRecord[] {
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let recordLine = 1;
  let i = 0;
  const endRecord = () => {
    fields.push(field);
    if (fields.length > 1 || fields[0] !== '') {
      records.push({ line: recordLine, fields });
    }
    fields = [];
    field = '';
  };
  while (i < text.length) {
    const char = text[i];
    const lineEnd = char === '\n' || char === '\r';
    const crlf = char === '\r' && text[i + 1] === '\n';
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 2;
        continue;
      }
      if (char === '"') {
        quoted = false;
      } else {
        field += crlf ? '\r\n' : char;
        if (lineEnd) line += 1;
      }
      i += crlf ? 2 : 1;
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      fields.push(field);
      field = '';
    } else if (lineEnd) {
      endRecord();
      line += 1;
      recordLine = line;
      if (crlf) i += 1;
    } else {
      field += char;
    }
    i += 1;
  }
  if (quoted) {
    throw new MalformedCsvError('The file ends inside a quoted field.');
  }
  if (field !== '' || fields.length > 0) endRecord();
  return records;
}
