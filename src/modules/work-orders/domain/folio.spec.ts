import { formatFolio, parseFolio } from './folio.js';

/** The folio of a work order (ADR-0166). */
describe('folio', () => {
  it('shows the number with the prefix and at least six digits', () => {
    expect(formatFolio(1)).toBe('OT-000001');
    expect(formatFolio(123)).toBe('OT-000123');
    expect(formatFolio(999_999)).toBe('OT-999999');
    expect(formatFolio(1_234_567)).toBe('OT-1234567');
  });

  it.each([
    ['OT-000123', 123],
    ['ot-123', 123],
    ['OT123', 123],
    ['123', 123],
    ['  OT-000123  ', 123],
    ['OT-1234567', 1_234_567],
    ['9'.repeat(15), 999_999_999_999_999],
  ])('reads %j as %d', (text, number) => {
    expect(parseFolio(text)).toBe(number);
  });

  it.each(['', 'OT-', 'OT--123', 'OTX123', 'OT-12a', 'X-123', '1'.repeat(16)])(
    'reads %j as no folio',
    (text) => {
      expect(parseFolio(text)).toBeNull();
    },
  );
});
