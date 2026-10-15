import {
  isExclusionViolation,
  isForeignKeyViolation,
  isUniqueViolation,
  uniqueViolationIndex,
} from './prisma-errors.js';

/** An error as Prisma throws it, with the cause the PostgreSQL adapter gives. */
const prismaError = (
  code: string,
  cause: Record<string, unknown> = {},
): unknown => ({ code, meta: { driverAdapterError: { cause } } });

/** The error of a raw query, which carries only the code of PostgreSQL (ADR-0164). */
const rawError = (originalCode: string, index?: string): unknown =>
  prismaError('P2010', {
    originalCode,
    ...(index === undefined ? {} : { constraint: { index } }),
  });

describe('Prisma errors (ADR-0112, ADR-0164)', () => {
  it.each([
    ['a unique violation', prismaError('P2002'), true],
    ['a unique violation of a raw query', rawError('23505'), true],
    ['another error of a raw query', rawError('23503'), false],
    ['another Prisma error', prismaError('P2003'), false],
    ['an error without code', new Error('Lost connection'), false],
    ['nothing', undefined, false],
  ])('tells %s as a unique violation: %s', (_, error, expected) => {
    expect(isUniqueViolation(error)).toBe(expected);
  });

  it.each([
    ['a foreign key violation', prismaError('P2003'), true],
    ['a foreign key violation of a raw query', rawError('23503'), true],
    ['another error of a raw query', rawError('23505'), false],
    ['another Prisma error', prismaError('P2002'), false],
    ['an error of a raw query without its code', prismaError('P2010'), false],
  ])('tells %s as a foreign key violation: %s', (_, error, expected) => {
    expect(isForeignKeyViolation(error)).toBe(expected);
  });

  it('names the unique index, also of a raw query', () => {
    expect(
      uniqueViolationIndex(
        prismaError('P2002', { constraint: { index: 'products_slug_key' } }),
      ),
    ).toBe('products_slug_key');
    expect(uniqueViolationIndex(rawError('23505', 'products_slug_key'))).toBe(
      'products_slug_key',
    );
    expect(uniqueViolationIndex(rawError('23505'))).toBeUndefined();
    expect(
      uniqueViolationIndex(rawError('23503', 'products_slug_key')),
    ).toBeUndefined();
  });

  it('tells an exclusion violation by the code of PostgreSQL', () => {
    expect(
      isExclusionViolation(prismaError('P2010', { originalCode: '23P01' })),
    ).toBe(true);
    expect(isExclusionViolation(rawError('23505'))).toBe(false);
    expect(isExclusionViolation(null)).toBe(false);
  });
});
