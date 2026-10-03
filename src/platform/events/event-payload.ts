import type { DomainEvent } from '../../shared-kernel/index.js';

/** Marks a date in a stored payload: `{ "$date": "2026-10-03T12:00:00.000Z" }`. */
const DATE_TAG = '$date';

/**
 * A domain event as `domain_events.payload` keeps it (ADR-0150): plain JSON, with each `Date` tagged so it comes back
 * as a `Date`. Values with `toJSON`, such as `Money`, keep only what it returns.
 */
export function toPayload(event: DomainEvent): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify(event, function (this: Record<string, unknown>, key, value) {
      // `value` went through Date.prototype.toJSON already; the holder still has the Date.
      const original = this[key];
      return original instanceof Date
        ? { [DATE_TAG]: original.toISOString() }
        : (value as unknown);
    }),
  ) as Record<string, unknown>;
}

/** The event a stored payload holds, with its dates back as dates. */
export function fromPayload(payload: unknown): DomainEvent {
  return JSON.parse(JSON.stringify(payload), (_key, value: unknown) =>
    isTaggedDate(value) ? new Date(value[DATE_TAG]) : value,
  ) as DomainEvent;
}

function isTaggedDate(value: unknown): value is { [DATE_TAG]: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value);
  return (
    keys.length === 1 &&
    keys[0] === DATE_TAG &&
    typeof (value as Record<string, unknown>)[DATE_TAG] === 'string'
  );
}
