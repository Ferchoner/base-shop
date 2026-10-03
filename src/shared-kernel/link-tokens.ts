import { createHash, randomBytes } from 'node:crypto';

/**
 * Tokens of the links sent by email, for email verification, password recovery and access to the guest orders
 * of an email (ADR-0046, ADR-0056, ADR-0148): 256 random bits in base64url. Only their SHA-256 is stored; with
 * that entropy, a fast hash is enough.
 */
export function newLinkToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashLinkToken(token) };
}

export function hashLinkToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
