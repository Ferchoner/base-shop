import { escapeLineBreaks, redact } from './log-redaction.js';

const JWT =
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';

describe('redact (ADR-0097)', () => {
  it.each([
    [
      'an email address',
      'Order placed by ana.perez+tienda@example.com.mx',
      'Order placed by [redacted]',
    ],
    ['a JWT', `Token ${JWT} expired`, 'Token [redacted] expired'],
    ['a Bearer token', `Header: Bearer ${JWT}`, 'Header: Bearer [redacted]'],
    [
      'an opaque Bearer token',
      'authorization=bearer abc123._~+/=',
      'authorization=Bearer [redacted]',
    ],
  ])('replaces %s', (_case, text, expected) => {
    expect(redact(text)).toBe(expected);
  });

  it.each([
    'GET /v1/catalog/products 200 3.1 ms',
    'at file:///C:/Projects/base-shop/node_modules/@nestjs/core/router.js:12:5',
    'Resolved prisma@7.10.0 and user@localhost',
  ])('leaves ordinary text untouched: %p', (text) => {
    expect(redact(text)).toBe(text);
  });
});

describe('escapeLineBreaks', () => {
  it('keeps a message on one line', () => {
    expect(escapeLineBreaks('first\r\nfake entry')).toBe(
      'first\\r\\nfake entry',
    );
  });
});
