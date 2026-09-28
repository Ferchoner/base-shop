import { readFile } from 'node:fs/promises';
import type { GeoCatalogRow } from '../domain/geo-catalog.js';

/** Columns of the INEGI municipal catalog (AGEEML, "Catálogo de Municipios Nacional") that the import reads. */
const COLUMNS = ['CVE_ENT', 'NOM_ENT', 'CVE_MUN', 'NOM_MUN'] as const;

/** A catalog file that cannot be read: wrong encoding, not a CSV or missing columns. */
export class UnreadableCatalogFileError extends Error {}

/**
 * Reads the INEGI municipal catalog as downloaded and unzipped: the UTF-8 CSV (`AGEEML_..._utf8.csv`), one
 * row per municipality (ADR-0057). The other files of the ZIP are not supported; the one without `_utf8` is
 * not UTF-8 and is rejected rather than read with broken accents.
 */
export async function readInegiCatalogFile(
  path: string,
): Promise<GeoCatalogRow[]> {
  return parseInegiCatalog(await readFile(path));
}

export function parseInegiCatalog(content: Uint8Array): GeoCatalogRow[] {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(content);
  } catch {
    throw new UnreadableCatalogFileError(
      'The file is not UTF-8. Use the CSV whose name ends in _utf8.csv.',
    );
  }
  const [header, ...records] = parseCsv(text.replace(/^﻿/, ''));
  if (header === undefined) {
    throw new UnreadableCatalogFileError('The file is empty.');
  }
  const positions = COLUMNS.map((column) => header.indexOf(column));
  const missing = COLUMNS.filter((_, i) => positions[i] === -1);
  if (missing.length > 0) {
    throw new UnreadableCatalogFileError(
      `The file lacks the columns ${missing.join(', ')}. Is it the INEGI municipal catalog?`,
    );
  }
  const [stateCode, stateName, municipalityKey, municipalityName] = positions;
  return records.map((record) => ({
    stateCode: record[stateCode] ?? '',
    stateName: record[stateName] ?? '',
    // CVE_MUN is the 3-digit key within the state; the stored key has the 2 of the state first.
    municipalityCode: `${record[stateCode] ?? ''}${record[municipalityKey] ?? ''}`,
    municipalityName: record[municipalityName] ?? '',
  }));
}

/**
 * RFC 4180 CSV: comma-separated fields, optionally in double quotes, where a quoted field may hold commas,
 * line breaks and doubled quotes. Accepts LF and CRLF line ends and skips empty lines.
 */
export function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const endRecord = () => {
    record.push(field);
    if (record.length > 1 || record[0] !== '') records.push(record);
    record = [];
    field = '';
  };
  while (i < text.length) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 2;
        continue;
      }
      if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      i += 1;
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      record.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      endRecord();
      if (char === '\r' && text[i + 1] === '\n') i += 1;
    } else {
      field += char;
    }
    i += 1;
  }
  if (quoted) {
    throw new UnreadableCatalogFileError(
      'The file ends inside a quoted field.',
    );
  }
  if (field !== '' || record.length > 0) endRecord();
  return records;
}
