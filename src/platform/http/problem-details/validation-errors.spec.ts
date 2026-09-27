import type { ValidationError } from '@nestjs/common';
import { toFieldErrors } from './validation-errors.js';

function error(
  property: string,
  constraints: Record<string, string> = {},
  more: Partial<ValidationError> = {},
): ValidationError {
  return { property, constraints, children: [], ...more };
}

describe('toFieldErrors', () => {
  it('translates class-validator constraints into Spanish messages', () => {
    expect(
      toFieldErrors([
        error('quantity', { isInt: 'quantity must be an integer' }),
      ]),
    ).toEqual([
      {
        field: 'quantity',
        code: 'isInt',
        message: 'Debe ser un número entero.',
      },
    ]);
  });

  it('uses the message a DTO gives in the decorator context', () => {
    expect(
      toFieldErrors([
        error(
          'postalCode',
          { matches: 'postalCode must match /^\\d{5}$/' },
          { contexts: { matches: { message: 'Debe tener 5 dígitos.' } } },
        ),
      ]),
    ).toEqual([
      {
        field: 'postalCode',
        code: 'matches',
        message: 'Debe tener 5 dígitos.',
      },
    ]);
  });

  it('falls back to a generic message for an unknown constraint', () => {
    expect(
      toFieldErrors([error('code', { isSku: 'code must be a SKU' })]),
    ).toEqual([
      { field: 'code', code: 'isSku', message: 'El valor no es válido.' },
    ]);
  });

  it('builds paths for nested objects and array items', () => {
    const nested = error(
      'shippingAddress',
      {},
      {
        children: [error('phone', { isString: 'phone must be a string' })],
      },
    );
    const lines = error(
      'lines',
      {},
      {
        children: [
          error(
            '2',
            {},
            {
              children: [
                error('quantity', { min: 'quantity must not be less than 1' }),
              ],
            },
          ),
        ],
      },
    );

    expect(toFieldErrors([nested, lines]).map((entry) => entry.field)).toEqual([
      'shippingAddress.phone',
      'lines[2].quantity',
    ]);
  });

  it('never includes the English message of class-validator', () => {
    const [entry] = toFieldErrors([
      error('isAdmin', {
        whitelistValidation: 'property isAdmin should not exist',
      }),
    ]);

    expect(entry.message).toBe('No es un campo permitido.');
  });
});
