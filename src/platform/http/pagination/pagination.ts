import { ValidateBy, type ValidationOptions } from 'class-validator';
import type {
  Page,
  PageRequest,
  SortOrder,
} from '../../../shared-kernel/index.js';
import type { PageMetaDto } from './page-query.dto.js';

/**
 * `sort` of a listing (ADR-0036): one of the given fields, with a `-` prefix for descending order. Each
 * listing declares which fields it can be sorted by; any other value is a validation error.
 */
export function IsSortOf(
  fields: readonly string[],
  options?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isSortOf',
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && fields.includes(value.replace(/^-/, '')),
        // Never shown (responses use the Spanish context message), but class-validator only attaches the
        // context of a failed rule that has a message.
        defaultMessage: () => '$property is not a sortable field',
      },
    },
    {
      ...options,
      context: {
        message: `Debe ser uno de: ${fields.flatMap((f) => [f, `-${f}`]).join(', ')}.`,
      },
    },
  );
}

/** The `sort` parameter as a sort order, or the listing's default when it is missing. */
export function toSortOrder<Field extends string>(
  sort: string | undefined,
  defaultSort: Field | `-${Field}`,
): SortOrder<Field> {
  const value = sort ?? defaultSort;
  return value.startsWith('-')
    ? { field: value.slice(1) as Field, direction: 'desc' }
    : { field: value as Field, direction: 'asc' };
}

/** A listing response (ADR-0036): `data` with this page's results and `meta` with the counts. */
export interface PageResponse<T> {
  readonly data: T[];
  readonly meta: PageMetaDto;
}

export function toPageResponse<Item, Dto>(
  page: Page<Item>,
  request: PageRequest,
  toDto: (item: Item) => Dto,
): PageResponse<Dto> {
  return {
    data: page.items.map(toDto),
    meta: {
      page: request.page,
      pageSize: request.pageSize,
      totalItems: page.totalItems,
      totalPages: Math.ceil(page.totalItems / request.pageSize),
    },
  };
}
