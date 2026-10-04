import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import {
  AuditTrail,
  DomainError,
  type DomainErrorCategory,
  newId,
} from '../../../shared-kernel/index.js';
import { CORRELATION_ID_HEADER } from '../correlation-id.js';
import { ProblemException } from './problem.exception.js';
import {
  isProblemCode,
  PROBLEM_TYPES,
  type ProblemCode,
  problemTypeUri,
} from './problem-types.js';

/** HTTP status of each domain error category (ADR-0064, ADR-0094). */
const CATEGORY_STATUS: Readonly<Record<DomainErrorCategory, number>> = {
  invalid: 400,
  forbidden: 403,
  'not-found': 404,
  conflict: 409,
  'too-large': 413,
  unsupported: 415,
};

/** Problem type used for an HTTP error raised by the framework itself, such as an unknown route. */
const STATUS_CODES: Readonly<Record<number, ProblemCode>> = {
  400: 'validation-error',
  401: 'unauthenticated',
  403: 'forbidden',
  404: 'not-found',
  413: 'payload-too-large',
  415: 'unsupported-media-type',
  429: 'rate-limit-exceeded',
};

/**
 * Administrative routes, where a 403 is an audited security event (ADR-0037, ADR-0100). Matched without case, as
 * Express routes, so `/V1/ADMIN` is audited too (T-310).
 */
const ADMIN_PATH = /^\/v\d+\/admin(\/|$)/i;

/** Members of RFC 9457 and `correlationId`; an extension can never replace them. */
const RESERVED_MEMBERS = new Set([
  'type',
  'title',
  'status',
  'detail',
  'instance',
  'correlationId',
]);

interface Problem {
  readonly code: string;
  readonly status: number;
  readonly title: string;
  readonly detail: string;
  readonly extensions: Readonly<Record<string, unknown>>;
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * Turns every error into Problem Details (RFC 9457) with `application/problem+json` (ADR-0035, ADR-0064,
 * ADR-0095). Responses never carry stack traces or internal messages, in any environment: those go to the
 * log together with the correlation id. A 403 on an administrative route is also recorded in the audit
 * trail (ADR-0100).
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly cls: ClsService,
    private readonly audit: AuditTrail,
  ) {}

  async catch(exception: unknown, host: ArgumentsHost): Promise<void> {
    const http = host.switchToHttp();
    const request = http.getRequest<{
      method: string;
      originalUrl?: string;
      url: string;
      route?: { path?: string };
    }>();
    const response = http.getResponse<unknown>();
    const adapter = this.adapterHost.httpAdapter;

    const correlationId = this.correlationId();
    const problem = this.toProblem(exception, correlationId);

    // Path only: the query string could hold search text or filters.
    const path = (request.originalUrl ?? request.url).split('?')[0];
    if (problem.status === 403 && ADMIN_PATH.test(path)) {
      await this.auditDeniedAccess(
        `${request.method} ${request.route?.path ?? path}`,
      );
    }

    const body: Record<string, unknown> = {
      type: problemTypeUri(problem.code),
      title: problem.title,
      status: problem.status,
      detail: problem.detail,
      instance: path,
      correlationId,
    };
    for (const [name, value] of Object.entries(problem.extensions)) {
      if (!RESERVED_MEMBERS.has(name)) body[name] = value;
    }

    adapter.setHeader(response, 'Content-Type', 'application/problem+json');
    adapter.setHeader(response, CORRELATION_ID_HEADER, correlationId);
    for (const [name, value] of Object.entries(problem.headers)) {
      adapter.setHeader(response, name, value);
    }
    adapter.reply(response, body, problem.status);
  }

  /** An audit failure is logged and never changes the response. */
  private async auditDeniedAccess(route: string): Promise<void> {
    try {
      await this.audit.recordIndependently({
        action: 'http.access-denied',
        resource: { type: 'route', id: route },
        result: 'DENIED',
      });
    } catch (error) {
      this.logger.error(
        `Could not audit a denied access to ${route}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /** The id set by the correlation middleware, or a new one when the error happened outside of it. */
  private correlationId(): string {
    const id = this.cls.isActive() ? this.cls.getId() : undefined;
    return id ?? newId();
  }

  private toProblem(exception: unknown, correlationId: string): Problem {
    if (exception instanceof ProblemException) {
      return {
        ...fromCatalog(exception.code),
        extensions: exception.extensions,
        headers: exception.headers,
      };
    }
    if (exception instanceof DomainError) {
      return this.fromDomainError(exception, correlationId);
    }
    const status = httpStatusOf(exception);
    const code = status === undefined ? undefined : STATUS_CODES[status];
    if (code !== undefined) {
      return { ...fromCatalog(code), extensions: {}, headers: {} };
    }
    this.logger.error(
      `Unhandled error (correlationId=${correlationId})`,
      exception instanceof Error ? exception.stack : String(exception),
    );
    return { ...fromCatalog('internal-error'), extensions: {}, headers: {} };
  }

  private fromDomainError(error: DomainError, correlationId: string): Problem {
    // The message is written for developers, in English: it goes to the log, never to the client.
    this.logger.debug(
      `${error.name} ${error.code}: ${error.message} (correlationId=${correlationId})`,
    );
    const status = CATEGORY_STATUS[error.category];
    const extensions = error.details ?? {};
    if (isProblemCode(error.code)) {
      const { title, detail } = PROBLEM_TYPES[error.code];
      return {
        code: error.code,
        status,
        title,
        detail,
        extensions,
        headers: {},
      };
    }
    this.logger.warn(
      `Domain error code "${error.code}" is not in the problem type catalog (correlationId=${correlationId})`,
    );
    const { title, detail } = PROBLEM_TYPES[CATEGORY_FALLBACK[error.category]];
    return { code: error.code, status, title, detail, extensions, headers: {} };
  }
}

/** Texts used for a domain error whose code is missing from the catalog. */
const CATEGORY_FALLBACK: Readonly<Record<DomainErrorCategory, ProblemCode>> = {
  invalid: 'validation-error',
  forbidden: 'forbidden',
  'not-found': 'not-found',
  conflict: 'invalid-state-transition',
  'too-large': 'payload-too-large',
  unsupported: 'unsupported-media-type',
};

function fromCatalog(
  code: ProblemCode,
): Omit<Problem, 'extensions' | 'headers'> {
  return { code, ...PROBLEM_TYPES[code] };
}

/**
 * Status of an HTTP error raised by NestJS or by the body parser (malformed JSON, body too large,
 * unsupported encoding). Anything else is an unexpected error.
 */
function httpStatusOf(exception: unknown): number | undefined {
  if (exception instanceof HttpException) return exception.getStatus();
  if (
    typeof exception === 'object' &&
    exception !== null &&
    'status' in exception &&
    typeof exception.status === 'number' &&
    'expose' in exception &&
    exception.expose === true
  ) {
    return exception.status;
  }
  return undefined;
}
