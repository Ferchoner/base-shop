import { emailSafeText } from './email-safe-text.js';

describe('emailSafeText (ADR-0154)', () => {
  it('keeps ordinary names, streets and numbers as they are', () => {
    expect(emailSafeText('María José')).toBe('María José');
    expect(emailSafeText('Av. Juárez 3.5')).toBe('Av. Juárez 3.5');
    expect(emailSafeText('Calle 5 de Mayo, int. 2-B')).toBe(
      'Calle 5 de Mayo, int. 2-B',
    );
  });

  it('puts the text on one line, without invisible characters', () => {
    const typed = [
      'Ana',
      String.fromCharCode(13, 10, 13, 10),
      'Tu cuenta',
      String.fromCharCode(0x2028),
      'fue',
      String.fromCharCode(0x202e),
      'suspendida',
      String.fromCharCode(0x200b, 9),
    ].join('');

    expect(emailSafeText(typed)).toBe('Ana Tu cuenta fue suspendida');
  });

  it('breaks links, so mail clients do not make them clickable', () => {
    expect(emailSafeText('Entra a https://tienda-falsa.com/pago')).toBe(
      'Entra a https: //tienda-falsa. com/pago',
    );
    expect(emailSafeText('www.tienda-falsa.com.mx')).toBe(
      'www. tienda-falsa. com. mx',
    );
    expect(emailSafeText('escribe a ana@tienda-falsa.com')).toBe(
      'escribe a ana@tienda-falsa. com',
    );
    expect(emailSafeText(`tienda${String.fromCharCode(0xff0e)}com`)).toBe(
      `tienda${String.fromCharCode(0xff0e)} com`,
    );
  });
});
