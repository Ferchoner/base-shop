/** `<amount><unit>`, with the unit in seconds, minutes, hours or days: `90s`, `15m`, `12h`, `7d`. */
export const DURATION_PATTERN = /^[1-9]\d*[smhd]$/;

const UNIT_SECONDS = { s: 1, m: 60, h: 3_600, d: 86_400 } as const;

/** Seconds of a duration such as `15m`; `undefined` when it does not match DURATION_PATTERN. */
export function durationSeconds(value: unknown): number | undefined {
  if (typeof value !== 'string' || !DURATION_PATTERN.test(value)) {
    return undefined;
  }
  const unit = value.slice(-1) as keyof typeof UNIT_SECONDS;
  return Number(value.slice(0, -1)) * UNIT_SECONDS[unit];
}

/** Reads a duration already validated at startup (ADR-0114). */
export function parseDuration(value: string): number {
  const seconds = durationSeconds(value);
  if (seconds === undefined) {
    throw new Error(`Invalid duration "${value}", expected a value like 15m`);
  }
  return seconds;
}
