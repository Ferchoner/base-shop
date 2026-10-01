import { ProblemException } from '../problem-details/problem.exception.js';
import { decodeCursor, encodeCursor } from './cursor.js';

const position = (value: Readonly<Record<string, unknown>>) =>
  typeof value.id === 'string' ? { id: value.id } : null;

describe('Cursor pagination (API_SPEC.md §5.2)', () => {
  it('gives back the position it encoded, in an opaque, URL-safe cursor', () => {
    const cursor = encodeCursor({
      createdAt: '2026-10-01T12:00:00.000Z',
      id: 'a+b/c',
    });

    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(cursor, (value) => ({ ...value }))).toEqual({
      createdAt: '2026-10-01T12:00:00.000Z',
      id: 'a+b/c',
    });
  });

  it.each([
    ['not base64url JSON', 'no es un cursor'],
    ['a list', Buffer.from('[1,2]').toString('base64url')],
    ['a plain value', Buffer.from('"x"').toString('base64url')],
    ['a position the listing does not know', encodeCursor({ page: '2' })],
  ])('answers 400 on cursor for %s', (_, cursor) => {
    let thrown: unknown;
    try {
      decodeCursor(cursor, position);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ProblemException);
    expect(thrown).toMatchObject({
      code: 'validation-error',
      extensions: {
        errors: [expect.objectContaining({ field: 'cursor', code: 'cursor' })],
      },
    });
  });
});
