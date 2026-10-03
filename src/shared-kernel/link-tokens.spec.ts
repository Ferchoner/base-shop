import { createHash } from 'node:crypto';
import { hashLinkToken, newLinkToken } from './link-tokens.js';

describe('link tokens (ADR-0046, ADR-0056)', () => {
  it('are 256 random bits in base64url, stored only as their SHA-256', () => {
    const { token, hash } = newLinkToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(hashLinkToken(token)).toBe(hash);
  });

  it('never repeat', () => {
    expect(newLinkToken().token).not.toBe(newLinkToken().token);
  });
});
