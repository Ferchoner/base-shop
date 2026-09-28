import type { ArgumentMetadata } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { createValidationPipe } from '../problem-details/validation-errors.js';
import { PageQueryDto } from './page-query.dto.js';
import { IsSortOf, toPageResponse, toSortOrder } from './pagination.js';

class SampleListQuery extends PageQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

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
): Promise<{ field: string; message: string }[]> {
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

  it('accepts a declared sort field, ascending or descending', async () => {
    expect((await parse({ sort: '-createdAt' })).sort).toBe('-createdAt');
  });

  it('rejects an undeclared sort field, listing the valid ones in Spanish', async () => {
    expect(await errorsOf({ sort: 'email' })).toEqual([
      expect.objectContaining({
        field: 'sort',
        message: 'Debe ser uno de: name, -name, createdAt, -createdAt.',
      }),
    ]);
  });

  it('rejects an undeclared filter', async () => {
    expect((await errorsOf({ status: 'ACTIVE' })).map((e) => e.field)).toEqual([
      'status',
    ]);
  });
});

describe('toSortOrder', () => {
  it('reads the direction from the prefix', () => {
    expect(toSortOrder('-createdAt', 'name')).toEqual({
      field: 'createdAt',
      direction: 'desc',
    });
    expect(toSortOrder('name', '-createdAt')).toEqual({
      field: 'name',
      direction: 'asc',
    });
  });

  it('uses the default of the listing when sort is missing', () => {
    expect(toSortOrder(undefined, '-createdAt')).toEqual({
      field: 'createdAt',
      direction: 'desc',
    });
  });
});

describe('toPageResponse', () => {
  it('maps the items and computes the page counts', () => {
    const response = toPageResponse(
      { items: [{ n: 1 }, { n: 2 }], totalItems: 45 },
      { page: 3, pageSize: 20 },
      (item) => item.n * 10,
    );

    expect(response).toEqual({
      data: [10, 20],
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
