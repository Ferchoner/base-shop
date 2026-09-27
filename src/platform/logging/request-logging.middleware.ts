import { AsyncResource } from 'node:async_hooks';
import { Logger } from '@nestjs/common';

const logger = new Logger('HTTP');

interface LoggedRequest {
  method: string;
  originalUrl?: string;
  url: string;
}

interface LoggedResponse {
  statusCode: number;
  on(event: 'finish', listener: () => void): unknown;
}

/**
 * Writes one line per finished request (ADR-0097): method, path without the query string, status and
 * duration. Never bodies, headers or query strings, which may hold personal data or tokens. Mounted after the
 * correlation middleware, so the line carries the correlation id.
 */
export function requestLoggingMiddleware(
  request: LoggedRequest,
  response: LoggedResponse,
  next: () => void,
): void {
  const startedAt = process.hrtime.bigint();
  const path = (request.originalUrl ?? request.url).split('?')[0];
  // Bound to the current async context, so the listener still sees the correlation id of this request.
  response.on(
    'finish',
    AsyncResource.bind(() => {
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      logger.log(
        `${request.method} ${path} ${response.statusCode} ${elapsedMs.toFixed(1)} ms`,
      );
    }),
  );
  next();
}
