import { ProblemException } from '../problem-details/problem.exception.js';
import type { CursorMetaDto } from './cursor.dto.js';

/** A listing response paginated by cursor: `data` with this page's results and `meta` with the next cursor. */
export interface CursorPageResponse<T> {
  readonly data: T[];
  readonly meta: CursorMetaDto;
}

/** The opaque cursor of a position in a listing: its sort values, as base64url JSON. */
export function encodeCursor(
  position: Readonly<Record<string, string>>,
): string {
  return Buffer.from(JSON.stringify(position)).toString('base64url');
}

/**
 * The position of a cursor this API gave, read with `parse`, which answers `null` for one it does not
 * recognize.
 *
 * @throws ProblemException 400 `validation-error` on `cursor` when the cursor was not given by this listing
 * (API_SPEC.md §5.2).
 */
export function decodeCursor<Position>(
  cursor: string,
  parse: (position: Readonly<Record<string, unknown>>) => Position | null,
): Position {
  let position: unknown;
  try {
    position = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    position = null;
  }
  const parsed =
    typeof position === 'object' &&
    position !== null &&
    !Array.isArray(position)
      ? parse(position as Record<string, unknown>)
      : null;
  if (parsed === null) {
    throw new ProblemException('validation-error', {
      errors: [
        {
          field: 'cursor',
          code: 'cursor',
          message: 'No es un cursor de este listado.',
        },
      ],
    });
  }
  return parsed;
}
