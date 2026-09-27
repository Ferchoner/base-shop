/**
 * Patterns replaced in every log message and stack trace (ADR-0097), as a safety net: code must not log
 * personal data or credentials in the first place. `Bearer` goes first, so its JWT is replaced whole.
 */
const REDACTIONS: readonly (readonly [RegExp, string])[] = [
  [/\bBearer\s+[\w.~+/=-]+/gi, 'Bearer [redacted]'],
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[redacted]'],
  [/[\w.%+-]+@[\w-]+(?:\.[\w-]+)*\.[A-Za-z]{2,}/g, '[redacted]'],
];

/** Replaces email addresses, JWTs and Bearer tokens with `[redacted]`. */
export function redact(text: string): string {
  return REDACTIONS.reduce(
    (result, [pattern, replacement]) => result.replace(pattern, replacement),
    text,
  );
}

/** Keeps a text log entry on one line, so a message cannot fake extra log lines. */
export function escapeLineBreaks(text: string): string {
  return text.replace(/\r/g, '\\r').replace(/\n/g, '\\n');
}
