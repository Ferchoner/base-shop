import { isUsableLink, type OneTimeLink } from './one-time-link.js';

const NOW = new Date('2026-09-29T12:00:00Z');

function link(changes: Partial<OneTimeLink> = {}): OneTimeLink {
  return {
    expiresAt: new Date(NOW.getTime() + 60_000),
    usedAt: null,
    invalidatedAt: null,
    ...changes,
  };
}

describe('isUsableLink (BR-USR-11, BR-USR-16)', () => {
  it('is usable once, within its lifetime, until replaced', () => {
    expect(isUsableLink(link(), NOW)).toBe(true);
  });

  it.each([
    ['used', { usedAt: NOW }],
    ['replaced by a newer link', { invalidatedAt: NOW }],
    ['expired at this instant', { expiresAt: NOW }],
  ])('is not usable once %s', (_, changes) => {
    expect(isUsableLink(link(changes), NOW)).toBe(false);
  });
});
