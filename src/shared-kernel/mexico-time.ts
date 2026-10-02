/**
 * Dates in emails, as people in Mexico read them, like the store's schedules (ADR-0101): the account emails of
 * Identity & Access and the order emails (ADR-0143).
 */
const MEXICO_TIME = new Intl.DateTimeFormat('es-MX', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'America/Mexico_City',
});

/** `29 de septiembre de 2026 a las 10:05 a.m.`, in central Mexico time. */
export function inMexicoTime(date: Date): string {
  return MEXICO_TIME.format(date);
}
