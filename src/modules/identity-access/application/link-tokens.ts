import { createHash, randomBytes } from 'node:crypto';

/**
 * Tokens of the links sent by email, for email verification and password recovery (ADR-0046, ADR-0056):
 * 256 random bits in base64url. Only their SHA-256 is stored; with that entropy, a fast hash is enough.
 */
export function newLinkToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashLinkToken(token) };
}

export function hashLinkToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
