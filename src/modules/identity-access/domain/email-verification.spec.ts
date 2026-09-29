import { newId } from '../../../shared-kernel/index.js';
import {
  type EmailVerificationToken,
  isUsableVerification,
} from './email-verification.js';

const NOW = new Date('2026-09-29T12:00:00Z');

function token(
  changes: Partial<EmailVerificationToken> = {},
): EmailVerificationToken {
  return {
    id: newId(),
    userId: newId(),
    email: 'persona@example.com',
    tokenHash: 'a'.repeat(64),
    expiresAt: new Date(NOW.getTime() + 60_000),
    usedAt: null,
    invalidatedAt: null,
    ...changes,
  };
}

describe('isUsableVerification (BR-USR-11)', () => {
  it('is usable once, within its lifetime, until replaced', () => {
    expect(isUsableVerification(token(), NOW)).toBe(true);
  });

  it.each([
    ['used', { usedAt: NOW }],
    ['replaced by a newer link', { invalidatedAt: NOW }],
    ['expired at this instant', { expiresAt: NOW }],
  ])('is not usable once %s', (_, changes) => {
    expect(isUsableVerification(token(changes), NOW)).toBe(false);
  });
});
