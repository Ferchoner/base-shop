import { newId } from '../../../shared-kernel/index.js';
import { type RefreshTokenRecord, refreshTokenState } from './session.js';

const NOW = new Date('2026-09-29T12:00:00Z');
const LATER = new Date('2026-10-06T12:00:00Z');
const EARLIER = new Date('2026-09-22T12:00:00Z');

function token(changes: Partial<RefreshTokenRecord> = {}): RefreshTokenRecord {
  return {
    id: newId(),
    userId: newId(),
    sessionId: newId(),
    tokenHash: 'a'.repeat(64),
    expiresAt: LATER,
    revokedAt: null,
    replacedById: null,
    ...changes,
  };
}

describe('refreshTokenState (ADR-0023)', () => {
  it('is usable until it expires, unless revoked or rotated', () => {
    expect(refreshTokenState(token(), NOW)).toBe('usable');
  });

  it('expires at its expiry instant', () => {
    expect(refreshTokenState(token({ expiresAt: NOW }), NOW)).toBe('expired');
    expect(
      refreshTokenState(token({ expiresAt: new Date(NOW.getTime() + 1) }), NOW),
    ).toBe('usable');
  });

  it('is revoked once its session ends', () => {
    expect(refreshTokenState(token({ revokedAt: EARLIER }), NOW)).toBe(
      'revoked',
    );
  });

  it('is rotated once renewed, even if it has also expired, so presenting it again is always a reuse', () => {
    const rotated = {
      revokedAt: EARLIER,
      replacedById: newId<'RefreshToken'>(),
    };

    expect(refreshTokenState(token(rotated), NOW)).toBe('rotated');
    expect(
      refreshTokenState(token({ ...rotated, expiresAt: EARLIER }), NOW),
    ).toBe('rotated');
  });
});
