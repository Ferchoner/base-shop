/** `<count>/<duration>`, with the duration in seconds, minutes or hours: `5/15m`, `100/1m`, `3/1h`. */
export const RATE_LIMIT_PATTERN = /^[1-9]\d*\/[1-9]\d*[smh]$/;

export interface RateLimitValue {
  readonly limit: number;
  readonly windowMs: number;
}

const UNIT_MS = { s: 1_000, m: 60_000, h: 3_600_000 } as const;

/** Reads a rate limit already validated against RATE_LIMIT_PATTERN (ADR-0102). */
export function parseRateLimit(value: string): RateLimitValue {
  if (!RATE_LIMIT_PATTERN.test(value)) {
    throw new Error(
      `Invalid rate limit "${value}", expected a value like 5/15m`,
    );
  }
  const [count, duration] = value.split('/');
  const unit = duration.slice(-1) as keyof typeof UNIT_MS;
  return {
    limit: Number(count),
    windowMs: Number(duration.slice(0, -1)) * UNIT_MS[unit],
  };
}
