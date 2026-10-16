/** The prefix of every folio (ADR-0166). */
const PREFIX = 'OT-';

/** At least six digits, so the first folios read like the printed ones, such as `OT-000123`. */
const MIN_DIGITS = 6;

/**
 * The folio of a work order (ADR-0165, ADR-0166): its consecutive number from a database sequence, with the
 * prefix `OT-` and at least six digits. It grows past `OT-999999` to seven digits.
 */
export function formatFolio(number: number): string {
  return `${PREFIX}${String(number).padStart(MIN_DIGITS, '0')}`;
}

/**
 * The number of a folio as the staff types it: `OT-000123`, `ot-123`, `OT123` or `123`; `null` for anything
 * else. Up to 15 digits, so the number stays exact in JavaScript.
 */
export function parseFolio(text: string): number | null {
  const match = /^(?:OT-?)?([0-9]{1,15})$/i.exec(text.trim());
  return match === null ? null : Number(match[1]);
}
