/**
 * The deepest nesting a JSON body may have. The requests of the API reach 3 levels; a deeper body only serves to
 * exhaust the stack of code that walks it recursively, like the validation pipe and the fingerprint of an
 * idempotent request, which would answer 500 (T-310, ADR-0153).
 */
export const MAX_JSON_DEPTH = 32;

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const OPEN = new Set([0x5b, 0x7b]);
const CLOSE = new Set([0x5d, 0x7d]);

/** A body nested too deep, which the body parser answers as 400, like malformed JSON. */
class JsonTooDeepError extends Error {
  readonly status = 400;
  readonly expose = true;
  readonly type = 'entity.parse.failed';

  constructor() {
    super(`JSON nested deeper than ${MAX_JSON_DEPTH} levels`);
  }
}

/**
 * `verify` of the JSON body parser: walks the raw body once, without recursion, and rejects it when its arrays and
 * objects nest deeper than `MAX_JSON_DEPTH`. Brackets inside strings do not count.
 */
export function rejectDeeplyNestedJson(
  _request: unknown,
  _response: unknown,
  body: Buffer,
): void {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const byte of body) {
    if (inString) {
      if (escaped) escaped = false;
      else if (byte === BACKSLASH) escaped = true;
      else if (byte === QUOTE) inString = false;
    } else if (byte === QUOTE) {
      inString = true;
    } else if (OPEN.has(byte)) {
      depth += 1;
      if (depth > MAX_JSON_DEPTH) throw new JsonTooDeepError();
    } else if (CLOSE.has(byte)) {
      depth -= 1;
    }
  }
}
