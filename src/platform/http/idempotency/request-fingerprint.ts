import { createHash } from 'node:crypto';

/**
 * Fingerprint of what an idempotent request asks for (ADR-0099): SHA-256 of its route parameters and body,
 * with object keys sorted so the order of the fields does not matter.
 */
export function requestFingerprint(
  params: Readonly<Record<string, string>>,
  body: unknown,
): string {
  return createHash('sha256')
    .update(canonicalJson({ params, body: body ?? null }))
    .digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
