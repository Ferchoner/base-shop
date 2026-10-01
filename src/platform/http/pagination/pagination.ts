import { Transform } from 'class-transformer';
import { ValidateBy, type ValidationOptions } from 'class-validator';
import type {
  Page,
  PageRequest,
  SortOrder,
} from '../../../shared-kernel/index.js';
import type { PageMetaDto } from './page-query.dto.js';

/**
 * `sort` of a listing (ADR-0036, API_SPEC.md §5.3): one or more of the given fields separated by commas,
 * each with an optional `-` prefix for descending order (`sort=-createdAt,email`), and none repeated. Each
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
        validate: (value: unknown) => {
          if (typeof value !== 'string') return false;
          const names = value.split(',').map((part) => part.replace(/^-/, ''));
          return (
            names.every((name) => fields.includes(name)) &&
            new Set(names).size === names.length
          );
        },
        // Never shown (responses use the Spanish context message), but class-validator only attaches the
        // context of a failed rule that has a message.
        defaultMessage: () => '$property is not a list of sortable fields',
      },
    },
    {
      ...options,
      context: {
        message: `Debe ser uno o más de: ${fields.flatMap((f) => [f, `-${f}`]).join(', ')}, separados por comas y sin repetir.`,
      },
    },
  );
}

/** The `sort` parameter as sort orders, or the listing's default when it is missing. */
export function toSortOrders<Field extends string>(
  sort: string | undefined,
  defaultSort: string,
): SortOrder<Field>[] {
  return (sort ?? defaultSort)
    .split(',')
    .map((part) =>
      part.startsWith('-')
        ? { field: part.slice(1) as Field, direction: 'desc' }
        : { field: part as Field, direction: 'asc' },
    );
}

/**
 * A filter that takes several values separated by commas (API_SPEC.md §5.3, `status=ACTIVE,SUSPENDED`):
 * turns the query string into a list. Validate each value with `{ each: true }`.
 */
export function CommaSeparated(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value.split(',').map((item) => item.trim())
      : value,
  );
}

/** A date alone as the end of a range covers the whole day (API_SPEC.md §5.3, ADR-0112). */
export function rangeEnd(value: string | undefined): Date | undefined {
  if (value === undefined) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T23:59:59.999Z`);
  }
  return new Date(value);
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
