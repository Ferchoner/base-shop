import {
  formatPublicCode,
  newPublicCode,
  PUBLIC_CODE_ALPHABET,
  type PublicCode,
  parsePublicCode,
} from './public-code.js';

describe('Public code of an order (ADR-0049, BR-ORD-12)', () => {
  it('draws 8 random characters of Base32 Crockford, without I, L, O nor U', () => {
    const codes = Array.from({ length: 2_000 }, () => newPublicCode());

    for (const code of codes) expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(new Set(codes).size).toBe(codes.length);
    // Every symbol shows up: 16,000 draws of 32 symbols.
    expect(new Set(codes.join(''))).toEqual(new Set(PUBLIC_CODE_ALPHABET));
    expect(PUBLIC_CODE_ALPHABET).toHaveLength(32);
  });

  it('shows the code as XXXX-XXXX', () => {
    expect(formatPublicCode('K7M4Q9XA' as PublicCode)).toBe('K7M4-Q9XA');
  });

  it('reads a code in any case, with or without the dash in the middle', () => {
    for (const written of ['K7M4-Q9XA', 'k7m4-q9xa', 'K7M4Q9XA', 'k7M4q9Xa']) {
      expect(parsePublicCode(written)).toBe('K7M4Q9XA');
    }
  });

  it('reads anything else as no code', () => {
    for (const written of [
      '',
      'K7M4Q9X',
      'K7M4Q9XAB',
      'K7M-4Q9XA',
      'K7M4--Q9XA',
      'K7M4 Q9XA',
      'K7M4-Q9X',
      'ILOU1234',
      'K7M4-Q9XU',
    ]) {
      expect(parsePublicCode(written)).toBeNull();
    }
  });
});
