import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { catchError, from, mergeMap, type Observable, of } from 'rxjs';
import { Clock, DomainError } from '../../../shared-kernel/index.js';
import { ProblemException } from '../problem-details/problem.exception.js';
import { isProblemCode } from '../problem-details/problem-types.js';
import type { IdempotencyScopeResolver } from './idempotency-scope.js';
import {
  type IdempotencyAttempt,
  IdempotencyStore,
  type StoredResponse,
} from './idempotency.store.js';
import { requestFingerprint } from './request-fingerprint.js';

export const IDEMPOTENCY_SCOPE = Symbol('idempotency-scope');
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';
const MAX_KEY_LENGTH = 255;
/** Seconds a client should wait before retrying while the original request runs. */
const RETRY_AFTER_SECONDS = '2';

interface IdempotentRequest {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  params: Record<string, string>;
  body?: unknown;
  user?: unknown;
  /** The route Express matched, with its parameters unfilled; set before any interceptor runs. */
  route: { path: string };
}

interface IdempotentResponse {
  /**
   * The status NestJS set before the handler (the one of `@HttpCode`, or 201 for POST and 200 otherwise), or the one
   * the handler set itself. Express always has one.
   */
  statusCode: number;
  status(code: number): unknown;
  setHeader(name: string, value: string): unknown;
  getHeader(name: string): unknown;
}

/**
 * Applies `Idempotency-Key` to the endpoints marked with `@Idempotent` (ADR-0063, ADR-0099):
 * - same key and content: replays the stored response without running the operation again;
 * - same key and other content: 422; original request still running: 409 with `Retry-After`;
 * - keeps successes and business errors; frees the key after validation errors, also those the domain finds
 *   (such as a state that does not exist), and after unexpected errors.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly store: IdempotencyStore,
    private readonly clock: Clock,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const resolveScope = this.reflector.get<
      IdempotencyScopeResolver | undefined
    >(IDEMPOTENCY_SCOPE, context.getHandler());
    const http = context.switchToHttp();
    const request = http.getRequest<IdempotentRequest>();
    const response = http.getResponse<IdempotentResponse>();

    const key = readKey(request.headers['idempotency-key']);
    const scope = resolveScope?.(request);
    if (scope === undefined) return next.handle();

    const attempt: IdempotencyAttempt = {
      scope,
      endpoint: `${request.method} ${request.route.path}`,
      key,
      requestHash: requestFingerprint(request.params, request.body),
      startedAt: this.clock.now(),
    };
    const outcome = await this.store.begin(attempt);
    switch (outcome.kind) {
      case 'mismatch':
        throw new ProblemException('idempotency-key-mismatch');
      case 'in-progress':
        throw new ProblemException(
          'idempotency-request-in-progress',
          {},
          { 'Retry-After': RETRY_AFTER_SECONDS },
        );
      case 'replay':
        return replay(outcome.response, response);
      case 'started':
        return this.run(attempt, response, next);
    }
  }

  private run(
    attempt: IdempotencyAttempt,
    response: IdempotentResponse,
    next: CallHandler,
  ): Observable<unknown> {
    return next.handle().pipe(
      mergeMap((body) =>
        from(
          this.store
            .complete(attempt, {
              kind: 'success',
              status: response.statusCode,
              body: toJson(body),
              location: headerValue(response.getHeader('Location')),
            })
            .then(() => body),
        ),
      ),
      catchError((error: unknown) =>
        from(
          (async () => {
            if (
              error instanceof DomainError &&
              isProblemCode(error.code) &&
              error.code !== 'validation-error'
            ) {
              await this.store.complete(attempt, {
                kind: 'problem',
                code: error.code,
                extensions: toJson(error.details ?? {}) as Record<
                  string,
                  unknown
                >,
              });
            } else {
              await this.store.release(attempt);
            }
            throw error;
          })(),
        ),
      ),
    );
  }
}

/** @throws ProblemException when the key is missing, empty or longer than 255 characters. */
function readKey(header: string | string[] | undefined): string {
  const key = Array.isArray(header) ? header.join(',') : header;
  if (key === undefined || key.trim() === '') {
    throw new ProblemException('idempotency-key-missing');
  }
  if (key.length > MAX_KEY_LENGTH) {
    throw new ProblemException('validation-error', {
      errors: [
        {
          field: IDEMPOTENCY_KEY_HEADER,
          code: 'maxLength',
          message: 'Es más largo de lo permitido.',
        },
      ],
    });
  }
  return key;
}

function replay(
  stored: StoredResponse,
  response: IdempotentResponse,
): Observable<unknown> {
  if (stored.kind === 'problem' && isProblemCode(stored.code)) {
    throw new ProblemException(stored.code, stored.extensions);
  }
  if (stored.kind === 'problem') {
    throw new Error(`Stored problem code ${stored.code} is not in the catalog`);
  }
  response.status(stored.status);
  if (stored.location) response.setHeader('Location', stored.location);
  return of(stored.body);
}

/** The value as JSON would send it, so the stored response matches the original one. */
function toJson(value: unknown): unknown {
  return value === undefined
    ? null
    : (JSON.parse(JSON.stringify(value)) as unknown);
}

function headerValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
