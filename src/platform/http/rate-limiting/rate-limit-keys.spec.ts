import { parseRateLimit } from '../../config/rate-limit-value.js';
import { hashEmail, rateLimitKey } from './rate-limit-keys.js';

describe('rateLimitKey (ADR-0102)', () => {
  const ip = '203.0.113.7';
  const userId = '01a0e4c7-977b-73a2-bcde-dba943668375';
  const cartId = '5F0C2B1E-0000-4000-8000-000000000001';

  it('counts by IP', () => {
    expect(rateLimitKey('ip', { ip })).toBe(`ip:${ip}`);
  });

  it('counts by a hash of the email, never the email itself', () => {
    const key = rateLimitKey('email', {
      ip,
      body: { email: ' Ana@Example.com' },
    });

    expect(key).toBe(`email:${hashEmail('ana@example.com')}`);
    expect(key).not.toContain('example');
  });

  it('prefers the signed-in user over the email', () => {
    expect(
      rateLimitKey('user-or-email', {
        ip,
        user: { id: userId },
        body: { email: 'ana@example.com' },
      }),
    ).toBe(`user:${userId}`);
    expect(
      rateLimitKey('user-or-email', { ip, body: { email: 'a@b.mx' } }),
    ).toMatch(/^email:/);
  });

  it('counts orders by user, or by cart for guests', () => {
    expect(rateLimitKey('user-or-cart', { ip, user: { id: userId } })).toBe(
      `user:${userId}`,
    );
    expect(rateLimitKey('user-or-cart', { ip, body: { cartId } })).toBe(
      `cart:${cartId.toLowerCase()}`,
    );
  });

  it('falls back to the IP when the request lacks the field', () => {
    expect(rateLimitKey('email', { ip, body: {} })).toBe(`ip:${ip}`);
    expect(rateLimitKey('user-or-cart', { ip })).toBe(`ip:${ip}`);
  });
});

describe('parseRateLimit', () => {
  it.each([
    ['100/1m', 100, 60_000],
    ['5/15m', 5, 900_000],
    ['3/1h', 3, 3_600_000],
    ['2/30s', 2, 30_000],
  ])('reads %s', (value, limit, windowMs) => {
    expect(parseRateLimit(value)).toEqual({ limit, windowMs });
  });

  it.each(['0/1m', '5/0m', '5/15', '5 per minute', '-1/1h'])(
    'rejects %p',
    (value) => {
      expect(() => parseRateLimit(value)).toThrow(/Invalid rate limit/);
    },
  );
});
