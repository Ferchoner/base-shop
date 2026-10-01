import type { ArgumentMetadata, ValidationError } from '@nestjs/common';
import {
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { createValidationPipe, toFieldErrors } from './validation-errors.js';

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

  it('reports one constraint per field: presence and type before length, range or format (ADR-0130)', () => {
    expect(
      toFieldErrors([
        error('pageSize', { max: 'm', min: 'm', isInt: 'm' }),
        error('name', { isLength: 'm', isString: 'm' }),
        error('password', { maxLength: 'm', isString: 'm', isNotEmpty: 'm' }),
        error('freeShippingThreshold', {
          max: 'm',
          isInt: 'm',
          isDefined: 'm',
        }),
        error('lengthCm', { max: 'm', isNumber: 'm' }),
        error('dryRun', { isIn: 'm', isBoolean: 'm' }),
        error('categoryIds', { arrayMaxSize: 'm', isArray: 'm' }),
        error('options', { nestedValidation: 'm', isObject: 'm' }),
        error('extra', { whitelistValidation: 'm' }),
        error('when', { matches: 'm', isIso8601: 'm' }),
      ]).map(({ field, code }) => [field, code]),
    ).toEqual([
      ['pageSize', 'isInt'],
      ['name', 'isString'],
      ['password', 'isNotEmpty'],
      ['freeShippingThreshold', 'isDefined'],
      ['lengthCm', 'isNumber'],
      ['dryRun', 'isBoolean'],
      ['categoryIds', 'isArray'],
      ['options', 'isObject'],
      ['extra', 'whitelistValidation'],
      ['when', 'matches'],
    ]);
  });

  it('reports nothing of its own for a field whose errors are all in its children', () => {
    expect(
      toFieldErrors([
        error('address', {}, { children: [error('city', { isString: 'm' })] }),
      ]),
    ).toEqual([
      { field: 'address.city', code: 'isString', message: 'Debe ser texto.' },
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

/** The same rules, with the type check above and below the others: the order of the decorators never matters. */
class SampleBody {
  @IsString()
  @Length(1, 5)
  typeOnTop: string;

  @Length(1, 5)
  @IsString()
  typeBelow: string;

  @IsInt()
  @Min(1)
  @Max(10)
  quantity: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5)
  required: string;

  @IsOptional()
  @IsISO8601()
  @Matches(/^\d{4}-\d{2}-\d{2}T/, { context: { message: 'Con hora.' } })
  when?: string;
}

const BODY: ArgumentMetadata = { type: 'body', metatype: SampleBody };

async function bodyErrors(
  body: Record<string, unknown>,
): Promise<{ field: string; code: string }[]> {
  try {
    await createValidationPipe().transform(body, BODY);
  } catch (error) {
    return (
      error as { extensions: { errors: { field: string; code: string }[] } }
    ).extensions.errors.map(({ field, code }) => ({ field, code }));
  }
  throw new Error('The body was valid');
}

describe('createValidationPipe (ADR-0095, ADR-0130)', () => {
  it('reports the wrong type of a value, wherever its decorator is', async () => {
    expect(
      await bodyErrors({
        typeOnTop: 12_345_678,
        typeBelow: 12_345_678,
        quantity: 'abc',
        required: undefined,
      }),
    ).toEqual([
      { field: 'typeOnTop', code: 'isString' },
      { field: 'typeBelow', code: 'isString' },
      { field: 'quantity', code: 'isInt' },
      { field: 'required', code: 'isNotEmpty' },
    ]);
  });

  it('reports a range or format only for a value of the right type', async () => {
    expect(
      await bodyErrors({
        typeOnTop: 'abcdef',
        typeBelow: 'ok',
        quantity: 11,
        required: 'abcdef',
        when: '2026-10-01',
      }),
    ).toEqual([
      { field: 'typeOnTop', code: 'isLength' },
      { field: 'quantity', code: 'max' },
      { field: 'required', code: 'maxLength' },
      { field: 'when', code: 'matches' },
    ]);
  });
});
