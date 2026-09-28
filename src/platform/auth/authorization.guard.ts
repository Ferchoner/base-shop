import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PermissionCode } from '../../shared-kernel/index.js';
import { ProblemException } from '../http/problem-details/problem.exception.js';
import { authenticatedUserOf } from './authenticated-user.js';
import {
  type AccountRequirement,
  REQUIRED_ACCOUNT,
  REQUIRED_PERMISSIONS,
} from './authorization.decorators.js';

/** Route groups that always need a token (ADR-0036); a route in them without a requirement is a bug. */
const ADMIN_PATH = /^\/v\d+\/admin(\/|$)/;
const ACCOUNT_PATH = /^\/v\d+\/me(\/|$)/;

/**
 * Authorization of every request (ADR-0111), from the route metadata of `@RequirePermissions` and
 * `@RequireAccount` and the user that authentication left in `request.user` (T-120). Routes without them are
 * public. It fails closed: an administrative or account route that declares neither is a programming error,
 * answered 500 so it cannot go unnoticed as public.
 */
@Injectable()
export class AuthorizationGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const permissions = this.reflector.getAllAndOverride<
      PermissionCode[] | undefined
    >(REQUIRED_PERMISSIONS, targets);
    const account = this.reflector.getAllAndOverride<
      AccountRequirement | undefined
    >(REQUIRED_ACCOUNT, targets);
    const request = context
      .switchToHttp()
      .getRequest<{ path: string; user?: unknown }>();

    if (permissions === undefined && account === undefined) {
      if (ADMIN_PATH.test(request.path) || ACCOUNT_PATH.test(request.path)) {
        throw new Error(
          `Route ${request.path} needs @RequirePermissions or @RequireAccount (ADR-0111)`,
        );
      }
      return true;
    }
    if (ADMIN_PATH.test(request.path) && permissions === undefined) {
      throw new Error(
        `Administrative route ${request.path} needs @RequirePermissions (ADR-0111)`,
      );
    }

    // Authenticated responses are never stored by browsers or proxies, errors included (ADR-0071).
    context
      .switchToHttp()
      .getResponse<{ setHeader(name: string, value: string): void }>()
      .setHeader('Cache-Control', 'no-store');
    const user = authenticatedUserOf(request);
    if (user === undefined) throw new ProblemException('unauthenticated');
    if (user.mustChangePassword && !account?.allowPendingPasswordChange) {
      throw new ProblemException('password-change-required');
    }
    if (permissions !== undefined) {
      const allowed =
        user.type === 'STAFF' &&
        permissions.every((code) => user.permissions.includes(code));
      if (!allowed) throw new ProblemException('forbidden');
    }
    if (account?.customerOnly && user.type !== 'CUSTOMER') {
      throw new ProblemException('forbidden');
    }
    return true;
  }
}
