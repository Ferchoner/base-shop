import { isIP } from 'node:net';
import { CLS_REQ, ClsServiceManager } from 'nestjs-cls';

/** Longest user agent kept: enough to identify a client without storing arbitrary text. */
const MAX_USER_AGENT_LENGTH = 512;

/** What is known about the HTTP request being handled. Empty outside a request, for example in a job. */
export interface RequestContext {
  readonly correlationId?: string;
  readonly ip?: string;
  readonly userAgent?: string;
  /** Authenticated user; authentication (T-120) leaves it in `request.user.id`. */
  readonly userId?: string;
}

interface ContextRequest {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  user?: unknown;
}

/**
 * Reads the request saved by the correlation middleware in the async context (ADR-0095, ADR-0100), so code
 * outside controllers, such as the audit trail, knows who is calling and from where.
 */
export function currentRequestContext(): RequestContext {
  const cls = ClsServiceManager.getClsService();
  if (!cls.isActive()) return {};
  const request = cls.get<ContextRequest | undefined>(CLS_REQ);
  if (request === undefined) return {};
  const userAgent = request.headers?.['user-agent'];
  const user = request.user;
  const userId =
    typeof user === 'object' && user !== null && 'id' in user
      ? user.id
      : undefined;
  return {
    correlationId: cls.getId(),
    ip: request.ip && isIP(request.ip) ? request.ip : undefined,
    userAgent:
      typeof userAgent === 'string'
        ? userAgent.slice(0, MAX_USER_AGENT_LENGTH)
        : undefined,
    userId: typeof userId === 'string' ? userId : undefined,
  };
}
