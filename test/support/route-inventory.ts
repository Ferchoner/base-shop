import { type INestApplication, RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
  VERSION_METADATA,
} from '@nestjs/common/constants.js';
import { DiscoveryService, Reflector } from '@nestjs/core';
import {
  type AccountRequirement,
  REQUIRED_ACCOUNT,
  REQUIRED_PERMISSIONS,
} from '../../src/platform/auth/authorization.decorators.js';
import { IDEMPOTENCY_SCOPE } from '../../src/platform/http/idempotency/idempotency.interceptor.js';
import { RATE_LIMITS_METADATA } from '../../src/platform/http/rate-limiting/rate-limit.decorator.js';

/**
 * Who may call a route (ADR-0111): anyone; any account, also staff with a temporary password when it says so; only
 * customers; or staff with every listed permission.
 */
export type RouteAccess =
  | 'public'
  | 'account'
  | 'account, also with a temporary password'
  | 'customer'
  | readonly string[];

/** How a route is protected, as its decorators declare it (ADR-0153). */
export interface RouteSecurity {
  readonly access: RouteAccess;
  /** The specific limits of ADR-0065, instead of the default one; none for the default. */
  readonly limits?: readonly string[];
  /** Whose `Idempotency-Key` it requires: a guest cart's or a user's (ADR-0063). */
  readonly idempotent?: 'cart' | 'user';
}

/** A route's handler and its controller, in the order `Reflector` reads their metadata. */
type RouteTargets = [() => void, new () => object];

const join = (...parts: string[]) =>
  `/${parts
    .flatMap((part) => part.split('/'))
    .filter((part) => part !== '')
    .join('/')}`;

/** Calls `visit` with each route of the application, as `METHOD /v1/path/:param`, and its handler and controller. */
function eachRoute(
  app: INestApplication,
  visit: (route: string, targets: RouteTargets) => void,
): void {
  for (const wrapper of app.get(DiscoveryService).getControllers()) {
    const controller = wrapper.metatype as (new () => object) | null;
    if (controller === null) continue;
    const base = (Reflect.getMetadata(PATH_METADATA, controller) ??
      '') as string;
    const version = Reflect.getMetadata(VERSION_METADATA, controller) as
      string | undefined;
    for (const name of Object.getOwnPropertyNames(controller.prototype)) {
      const handler = (controller.prototype as Record<string, unknown>)[
        name
      ] as () => void;
      const path = Reflect.getMetadata(PATH_METADATA, handler) as
        string | undefined;
      if (name === 'constructor' || path === undefined) continue;
      const method =
        RequestMethod[
          Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod
        ];
      visit(`${method} ${join(`v${version ?? '1'}`, base, path)}`, [
        handler,
        controller,
      ]);
    }
  }
}

/**
 * Every route of the application with how it is protected, read from the metadata the guards and interceptors read
 * (`Reflector.getAllAndOverride`, the handler first, then its controller).
 */
export function routeInventory(
  app: INestApplication,
): Record<string, RouteSecurity> {
  const reflector = app.get(Reflector);
  const routes: Record<string, RouteSecurity> = {};
  eachRoute(app, (route, targets) => {
    const permissions = reflector.getAllAndOverride<string[] | undefined>(
      REQUIRED_PERMISSIONS,
      targets,
    );
    const account = reflector.getAllAndOverride<AccountRequirement | undefined>(
      REQUIRED_ACCOUNT,
      targets,
    );
    const limits = reflector.getAllAndOverride<string[] | undefined>(
      RATE_LIMITS_METADATA,
      targets,
    );
    const scope = reflector.get<{ name: string } | undefined>(
      IDEMPOTENCY_SCOPE,
      targets[0],
    );
    const access: RouteAccess =
      permissions !== undefined
        ? [...permissions]
        : account === undefined
          ? 'public'
          : account.customerOnly === true
            ? 'customer'
            : account.allowPendingPasswordChange === true
              ? 'account, also with a temporary password'
              : 'account';
    routes[route] = {
      access,
      ...(limits === undefined ? {} : { limits: [...limits] }),
      ...(scope === undefined
        ? {}
        : { idempotent: scope.name === 'cartScope' ? 'cart' : 'user' }),
    };
  });
  return routes;
}

/** The routes whose handler or controller uses `guard`, besides the global guards. */
export function routesGuardedBy(
  app: INestApplication,
  guard: abstract new (...args: never[]) => unknown,
): Set<string> {
  const reflector = app.get(Reflector);
  const routes = new Set<string>();
  eachRoute(app, (route, targets) => {
    const guards = reflector.getAllAndMerge<unknown[]>(
      GUARDS_METADATA,
      targets,
    );
    if (guards.includes(guard)) routes.add(route);
  });
  return routes;
}
