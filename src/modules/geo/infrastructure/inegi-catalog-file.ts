import { readFile } from 'node:fs/promises';
import { MalformedCsvError, parseCsv } from '../../../platform/files/csv.js';
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
  const [header, ...records] = readRecords(text.replace(/^﻿/, ''));
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

function readRecords(text: string): string[][] {
  try {
    return parseCsv(text).map(({ fields }) => fields);
  } catch (error) {
    if (error instanceof MalformedCsvError) {
      throw new UnreadableCatalogFileError(error.message);
    }
    throw error;
  }
}
