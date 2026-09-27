import { ProblemException } from './problem-details/problem.exception.js';

/** Media types a request body may have (`API_SPEC.md` §2): JSON, and multipart for image uploads. */
const ACCEPTED_MEDIA_TYPES = new Set([
  'application/json',
  'multipart/form-data',
]);

interface RequestHeaders {
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Rejects a request body of any other media type with 415 `unsupported-media-type` (ADR-0095). Requests
 * without a body, such as `POST /v1/carts`, pass whatever their `Content-Type`.
 */
export function rejectUnsupportedContentType(
  request: RequestHeaders,
  _response: unknown,
  next: (error?: unknown) => void,
): void {
  if (!hasBody(request)) return next();
  const contentType = request.headers['content-type'];
  const mediaType = (typeof contentType === 'string' ? contentType : '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (ACCEPTED_MEDIA_TYPES.has(mediaType)) return next();
  next(new ProblemException('unsupported-media-type'));
}

function hasBody({ headers }: RequestHeaders): boolean {
  return (
    headers['transfer-encoding'] !== undefined ||
    Number(headers['content-length'] ?? 0) > 0
  );
}
