/** Page of a listing (ADR-0036): `page` from 1, `pageSize` from 1 to 100. */
export interface PageRequest {
  readonly page: number;
  readonly pageSize: number;
}

/** Order of a listing: one declared field, ascending or descending. Repositories add the ID last. */
export interface SortOrder<Field extends string = string> {
  readonly field: Field;
  readonly direction: 'asc' | 'desc';
}

/** Results of one page, with the total count of every page. */
export interface Page<T> {
  readonly items: readonly T[];
  readonly totalItems: number;
}

/** Rows to skip for a page, for `OFFSET`. */
export function pageOffset(request: PageRequest): number {
  return (request.page - 1) * request.pageSize;
}
