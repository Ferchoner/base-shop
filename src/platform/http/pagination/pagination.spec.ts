import type { ArgumentMetadata } from '@nestjs/common';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { createValidationPipe } from '../problem-details/validation-errors.js';
import { PageQueryDto } from './page-query.dto.js';
import {
  CommaSeparated,
  IsSortOf,
  rangeEnd,
  toPageResponse,
  toSortOrders,
} from './pagination.js';

class SampleListQuery extends PageQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @CommaSeparated()
  @IsIn(['ACTIVE', 'SUSPENDED'], { each: true })
  status?: string[];

  @IsOptional()
  @IsSortOf(['name', 'createdAt'])
  sort?: string;
}

const METADATA: ArgumentMetadata = { type: 'query', metatype: SampleListQuery };

/** Runs a query through the API's own validation pipe, as a listing endpoint receives it. */
async function parse(query: Record<string, string>): Promise<SampleListQuery> {
  return (await createValidationPipe().transform(
    query,
    METADATA,
  )) as SampleListQuery;
}

async function errorsOf(
  query: Record<string, string>,
): Promise<{ field: string; code: string; message: string }[]> {
  try {
    await parse(query);
  } catch (error) {
    return (error as { extensions: { errors: [] } }).extensions.errors;
  }
  throw new Error('The query was valid');
}

describe('Listing query (ADR-0036)', () => {
  it('defaults to the first page of 20', async () => {
    expect(await parse({})).toMatchObject({ page: 1, pageSize: 20 });
  });

  it('converts page and pageSize from the query string', async () => {
    expect(await parse({ page: '3', pageSize: '100' })).toMatchObject({
      page: 3,
      pageSize: 100,
    });
  });

  it.each([
    [{ pageSize: '101' }, 'pageSize'],
    [{ pageSize: '0' }, 'pageSize'],
    [{ page: '0' }, 'page'],
    [{ page: '1.5' }, 'page'],
  ])('rejects %o', async (query, field) => {
    expect((await errorsOf(query)).map((e) => e.field)).toEqual([field]);
  });

  it.each([
    [{ pageSize: 'abc' }, 'pageSize'],
    [{ page: 'abc' }, 'page'],
  ])(
    'answers %o as not a number, not as out of range (ADR-0130)',
    async (query, field) => {
      expect(await errorsOf(query)).toEqual([
        { field, code: 'isInt', message: 'Debe ser un número entero.' },
      ]);
    },
  );

  it.each(['-createdAt', 'name', '-createdAt,name'])(
    'accepts the declared sort %p (API_SPEC.md §5.3)',
    async (sort) => {
      expect((await parse({ sort })).sort).toBe(sort);
    },
  );

  it.each(['email', 'name,email', 'name,-name', ''])(
    'rejects the sort %p, listing the valid fields in Spanish',
    async (sort) => {
      expect(await errorsOf({ sort })).toEqual([
        expect.objectContaining({
          field: 'sort',
          message:
            'Debe ser uno o más de: name, -name, createdAt, -createdAt, separados por comas y sin repetir.',
        }),
      ]);
    },
  );

  it('reads a filter with several values separated by commas', async () => {
    expect((await parse({ status: 'ACTIVE,SUSPENDED' })).status).toEqual([
      'ACTIVE',
      'SUSPENDED',
    ]);
  });

  it('rejects an undeclared value in a filter list', async () => {
    expect(
      (await errorsOf({ status: 'ACTIVE,DELETED' })).map((e) => e.field),
    ).toEqual(['status']);
  });

  it('rejects an undeclared filter', async () => {
    expect((await errorsOf({ role: 'admin' })).map((e) => e.field)).toEqual([
      'role',
    ]);
  });
});

describe('toSortOrders', () => {
  it('reads each field and its direction, in order', () => {
    expect(toSortOrders('-createdAt,name', 'name')).toEqual([
      { field: 'createdAt', direction: 'desc' },
      { field: 'name', direction: 'asc' },
    ]);
  });

  it('uses the default of the listing when sort is missing', () => {
    expect(toSortOrders(undefined, '-createdAt')).toEqual([
      { field: 'createdAt', direction: 'desc' },
    ]);
  });
});

describe('toPageResponse', () => {
  it('maps the items, with their place in the page, and computes the page counts', () => {
    const response = toPageResponse(
      { items: [{ n: 1 }, { n: 2 }], totalItems: 45 },
      { page: 3, pageSize: 20 },
      (item, index) => item.n * 10 + index,
    );

    expect(response).toEqual({
      data: [10, 21],
      meta: { page: 3, pageSize: 20, totalItems: 45, totalPages: 3 },
    });
  });

  it('has no pages when there are no results', () => {
    expect(
      toPageResponse(
        { items: [], totalItems: 0 },
        { page: 1, pageSize: 20 },
        String,
      ).meta.totalPages,
    ).toBe(0);
  });
});

describe('rangeEnd', () => {
  it('takes a date alone as the end of that whole day, and anything else as it is', () => {
    expect(rangeEnd('2026-10-31')).toEqual(
      new Date('2026-10-31T23:59:59.999Z'),
    );
    expect(rangeEnd('2026-10-31T12:00:00Z')).toEqual(
      new Date('2026-10-31T12:00:00.000Z'),
    );
    expect(rangeEnd(undefined)).toBeUndefined();
  });
});
