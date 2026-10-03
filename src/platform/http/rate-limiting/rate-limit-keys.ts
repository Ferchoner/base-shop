import { createHash } from 'node:crypto';

interface KeyedRequest {
  ip?: string;
  body?: unknown;
  user?: unknown;
}

/** What a limit counts by: the IP, an email of the body, the signed-in user, or a guest cart. */
export type RateLimitKey =
  'ip' | 'email' | 'contact-email' | 'user-or-email' | 'user-or-cart';

/**
 * The counter key of a request for a kind of limit (ADR-0102). Emails are kept only as SHA-256 hashes, so
 * no email stays in memory. When the request lacks the field, the IP is used: validation rejects the request
 * anyway.
 */
export function rateLimitKey(
  kind: RateLimitKey,
  request: KeyedRequest,
): string {
  const ip = `ip:${request.ip ?? 'unknown'}`;
  const userId = stringField(request.user, 'id');
  const email = stringField(request.body, 'email');
  const contactEmail = stringField(request.body, 'contactEmail');
  const cartId = stringField(request.body, 'cartId');
  switch (kind) {
    case 'ip':
      return ip;
    case 'email':
      return email ? `email:${hashEmail(email)}` : ip;
    case 'contact-email':
      return contactEmail ? `email:${hashEmail(contactEmail)}` : ip;
    case 'user-or-email':
      if (userId) return `user:${userId}`;
      return email ? `email:${hashEmail(email)}` : ip;
    case 'user-or-cart':
      if (userId) return `user:${userId}`;
      return cartId ? `cart:${cartId.toLowerCase()}` : ip;
  }
}

export function hashEmail(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

function stringField(source: unknown, field: string): string | undefined {
  if (typeof source !== 'object' || source === null || !(field in source)) {
    return undefined;
  }
  const value = (source as Record<string, unknown>)[field];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}
