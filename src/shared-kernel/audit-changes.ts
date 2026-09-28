/** A changed field: its old and new value, or only that it changed when the value must not be kept. */
export type AuditChange =
  { readonly from: unknown; readonly to: unknown } | { readonly changed: true };

export type AuditChanges = Readonly<Record<string, AuditChange>>;

/**
 * Field names never stored with their value, even if the caller forgets to declare them (ADR-0037,
 * ADR-0067): passwords, hashes, tokens, secrets and personal data. Matching is by substring, so
 * `contactEmail` or `shippingAddress` are hidden too.
 */
const ALWAYS_HIDDEN =
  /password|hash|token|secret|email|phone|firstnames?|lastnames?|fullname|address/i;

const REDACTED = '[redacted]';

export function isAlwaysHiddenField(name: string): boolean {
  return ALWAYS_HIDDEN.test(name);
}

/**
 * The fields that differ between two versions of a resource, for an audit entry (ADR-0100). Fields listed
 * in `personal`, and those always hidden, are recorded only as `{ changed: true }`. Values are kept as JSON
 * would send them (Money as `{ amount, currency }`, dates as ISO strings).
 */
export function changesBetween(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
  options: { readonly personal?: readonly string[] } = {},
): AuditChanges {
  const personal = new Set(options.personal ?? []);
  const changes: Record<string, AuditChange> = {};
  for (const field of new Set([
    ...Object.keys(before),
    ...Object.keys(after),
  ])) {
    const from = toJson(before[field]);
    const to = toJson(after[field]);
    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    changes[field] =
      personal.has(field) || isAlwaysHiddenField(field)
        ? { changed: true }
        : { from, to };
  }
  return changes;
}

/**
 * Applies the always-hidden list to changes built by hand, including field names nested inside values.
 * The audit trail calls it on every entry, as a safety net.
 */
export function redactAuditChanges(changes: AuditChanges): AuditChanges {
  const safe: Record<string, AuditChange> = {};
  for (const [field, change] of Object.entries(changes)) {
    safe[field] =
      'changed' in change || isAlwaysHiddenField(field)
        ? { changed: true }
        : { from: redactNested(change.from), to: redactNested(change.to) };
  }
  return safe;
}

function redactNested(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactNested);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        isAlwaysHiddenField(key) ? REDACTED : redactNested(entry),
      ]),
    );
  }
  return value;
}

function toJson(value: unknown): unknown {
  return value === undefined
    ? null
    : (JSON.parse(JSON.stringify(value)) as unknown);
}
