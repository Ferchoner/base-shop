import { ClsMiddleware } from 'nestjs-cls';
import { newId } from '../../shared-kernel/index.js';

/** Response header with the correlation id of the request (ADR-0071, `API_SPEC.md` §2). */
export const CORRELATION_ID_HEADER = 'X-Correlation-Id';

/**
 * Opens the async context of each request with a new correlation id (UUIDv7) and returns it in
 * `X-Correlation-Id` (ADR-0033, ADR-0095). The server always generates it: an id sent by the client is
 * ignored, so nobody can forge one or inject text into the logs.
 *
 * Mounted with `app.use` before the body parser, so even a malformed JSON body gets a correlation id.
 */
export function correlationIdMiddleware(): ClsMiddleware['use'] {
  return new ClsMiddleware({
    generateId: true,
    idGenerator: () => newId(),
    setup: (cls, _request, response: { setHeader: SetHeader }) => {
      response.setHeader(CORRELATION_ID_HEADER, cls.getId());
    },
  }).use;
}

type SetHeader = (name: string, value: string) => void;
