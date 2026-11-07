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

const MEXICO_DATE = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: 'America/Mexico_City',
});

const MEXICO_PARTS = new Intl.DateTimeFormat('en-US', {
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZone: 'America/Mexico_City',
});

/** A day of the calendar, `YYYY-MM-DD`. */
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The day of the calendar of central Mexico an instant falls on, as `YYYY-MM-DD` (ADR-0171). */
export function mexicoDateOf(instant: Date): string {
  return MEXICO_DATE.format(instant);
}

/** Whether the text is a real day of the calendar as `YYYY-MM-DD`, such as `2026-11-07` and not `2026-02-30`. */
export function isCalendarDate(text: string): boolean {
  const match = DATE.exec(text);
  if (match === null) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * The instants a day of central Mexico starts and ends, the end excluded (ADR-0171), whatever the offset of that day:
 * for the store's daily figures, such as the cash closing.
 *
 * @throws Error for a text that is not a day of the calendar.
 */
export function mexicoDayBounds(date: string): {
  readonly start: Date;
  readonly end: Date;
} {
  if (!isCalendarDate(date)) throw new Error(`Not a calendar date: ${date}`);
  const [year, month, day] = date.split('-').map(Number);
  return {
    start: mexicoMidnight(year, month, day),
    end: mexicoMidnight(year, month, day + 1),
  };
}

/** The instant central Mexico reaches midnight of that day; `Date.UTC` carries a day past the end of the month. */
function mexicoMidnight(year: number, month: number, day: number): Date {
  const utc = Date.UTC(year, month - 1, day);
  // Twice, in case the offset at the first guess is not the one of that midnight.
  let instant = utc - offsetAt(utc);
  instant = utc - offsetAt(instant);
  return new Date(instant);
}

/** How far central Mexico is from UTC at that instant, in milliseconds (negative: behind). */
function offsetAt(instant: number): number {
  const parts = Object.fromEntries(
    MEXICO_PARTS.formatToParts(new Date(instant)).map(({ type, value }) => [
      type,
      value,
    ]),
  );
  const local = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return local - Math.floor(instant / 1000) * 1000;
}
