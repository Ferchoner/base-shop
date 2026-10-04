import { readFileSync, writeFileSync } from 'node:fs';
import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { NoStaffPurchases } from '../src/platform/auth/no-staff-purchases.guard.js';
import { buildApiDocument } from '../src/platform/http/api-docs.js';
import { configureHttp } from '../src/platform/http/configure-http.js';
import { IDEMPOTENCY_KEY_HEADER } from '../src/platform/http/idempotency/idempotency.interceptor.js';
import {
  isProblemCode,
  PROBLEM_TYPES,
} from '../src/platform/http/problem-details/problem-types.js';
import { apiSpecRoutes } from './support/api-spec-routes.js';
import {
  routeInventory,
  routesGuardedBy,
  type RouteSecurity,
} from './support/route-inventory.js';

/** The OpenAPI document of `v1` kept in the repository (ADR-0155); `npm run openapi:update` writes it. */
const VERSIONED_DOCUMENT = 'docs/openapi/v1.json';
const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
/** Problem types any request can get (`API_SPEC.md` §6.3). */
const COMMON_PROBLEMS = [
  'validation-error',
  'rate-limit-exceeded',
  'internal-error',
];
const IDEMPOTENCY_PROBLEMS = [
  'idempotency-key-missing',
  'idempotency-key-mismatch',
  'idempotency-request-in-progress',
];

interface Operation {
  readonly summary?: string;
  readonly security?: readonly Record<string, unknown>[];
  readonly parameters?: readonly {
    name: string;
    in: string;
    required?: boolean;
  }[];
  readonly responses: Record<
    string,
    {
      description?: string;
      content?: Record<string, { schema?: { $ref?: string } }>;
    }
  >;
}

/** The value with its object keys sorted, so the versioned document diffs line by line. */
function sortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedKeys);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortedKeys((value as Record<string, unknown>)[key])]),
  );
}

/** Up to `limit` JSON paths where `actual` and `expected` differ. */
function differences(
  actual: unknown,
  expected: unknown,
  path = '$',
  found: string[] = [],
  limit = 20,
): string[] {
  if (found.length >= limit) return found;
  const bothObjects =
    typeof actual === 'object' &&
    actual !== null &&
    typeof expected === 'object' &&
    expected !== null &&
    Array.isArray(actual) === Array.isArray(expected);
  if (!bothObjects) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) found.push(path);
    return found;
  }
  const keys = new Set([
    ...Object.keys(actual as object),
    ...Object.keys(expected as object),
  ]);
  for (const key of keys) {
    differences(
      (actual as Record<string, unknown>)[key],
      (expected as Record<string, unknown>)[key],
      `${path}.${key}`,
      found,
      limit,
    );
  }
  return found;
}

/**
 * The contract of the API (T-320, ADR-0155): `API_SPEC.md` lists the routes of the application, the OpenAPI document
 * describes each one as the route matrix of T-310 protects it, and the document kept in the repository is the one the
 * application generates.
 */
describe('API contract (e2e, T-320)', () => {
  let app: INestApplication<App>;
  let document: OpenAPIObject;
  let routes: Record<string, RouteSecurity>;
  /** Routes that answer 403 `staff-cannot-purchase` to staff (E-09). */
  let noStaff: Set<string>;
  /** Each operation of the document, keyed like the route inventory. */
  let operations: Map<string, Operation>;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication<INestApplication<App>>();
    configureHttp(app);
    await app.init();
    document = buildApiDocument(app);
    routes = routeInventory(app);
    noStaff = routesGuardedBy(app, NoStaffPurchases);
    operations = new Map();
    for (const [path, item] of Object.entries(document.paths)) {
      for (const method of METHODS) {
        const operation = (item as Record<string, Operation | undefined>)[
          method
        ];
        if (operation === undefined) continue;
        const route = `${method.toUpperCase()} ${path.replace(/\{(\w+)\}/g, ':$1')}`;
        operations.set(route, operation);
      }
    }
  });

  afterAll(async () => {
    await app.close();
  });

  /** The problem types an error response lists, as `@ApiProblemResponses` writes them. */
  const typesOf = (response: { description?: string }) =>
    [...(response.description ?? '').matchAll(/`([a-z0-9-]+)`/g)].map(
      ([, code]) => code,
    );
  /** Every problem type an operation documents. */
  const problemsOf = (operation: Operation) =>
    new Set(
      Object.entries(operation.responses)
        .filter(([status]) => Number(status) >= 400)
        .flatMap(([, response]) => typesOf(response)),
    );
  /** The routes for which `test` finds something wrong, with what. */
  const violations = (
    test: (route: string, operation: Operation) => string[],
  ) =>
    [...operations].flatMap(([route, operation]) =>
      test(route, operation).map((problem) => `${route}: ${problem}`),
    );

  describe('API_SPEC.md', () => {
    const spec = apiSpecRoutes(readFileSync('docs/API_SPEC.md', 'utf8'));

    it('lists every route of the application, and only those, besides the ones still to be built', () => {
      const documented = [...spec].filter(([, row]) => !row.pending);
      const pending = [...spec].filter(([, row]) => row.pending);

      expect(documented.map(([route]) => route).sort()).toEqual(
        Object.keys(routes).sort(),
      );
      expect(pending.filter(([route]) => route in routes)).toEqual([]);
    });

    it('says who may call each route and which ones need Idempotency-Key, as the application requires', () => {
      const wrong = Object.entries(routes).flatMap(([route, security]) => {
        const row = spec.get(route);
        if (row === undefined) return [];
        const { access } = security;
        const written = row.access;
        const permissions = [
          ...written.replace(/\(.*?\)/g, '').matchAll(/`([a-z-]+\.[a-z-]+)`/g),
        ].map(([, code]) => code);
        const matches = written.startsWith('Público')
          ? access === 'public'
          : written.startsWith('Cuenta')
            ? access === 'account' ||
              access === 'account, also with a temporary password'
            : written.startsWith('Solo cliente')
              ? access === 'customer' ||
                (access === 'account' && noStaff.has(route))
              : Array.isArray(access) &&
                [...access].sort().join() === permissions.sort().join();
        const idempotent = written.includes(`\`${IDEMPOTENCY_KEY_HEADER}\``);
        return matches && idempotent === (security.idempotent !== undefined)
          ? []
          : [`${route}: "${written}"`];
      });

      expect(wrong).toEqual([]);
    });
  });

  describe('OpenAPI document', () => {
    it('has one operation per route of the application', () => {
      expect([...operations.keys()].sort()).toEqual(Object.keys(routes).sort());
    });

    it('gives every operation a summary and a success response with its schema', () => {
      expect(
        violations((_, operation) => {
          const success = Object.keys(operation.responses).filter((status) =>
            status.startsWith('2'),
          );
          return [
            ...(operation.summary ? [] : ['no summary']),
            ...(success.length > 0 ? [] : ['no success response']),
            ...success
              .filter(
                (status) =>
                  status !== '202' &&
                  status !== '204' &&
                  operation.responses[status].content === undefined,
              )
              .map((status) => `${status} without a schema`),
          ];
        }),
      ).toEqual([]);
    });

    it('documents the problems any request can get', () => {
      expect(
        violations((_, operation) =>
          COMMON_PROBLEMS.filter((code) => !problemsOf(operation).has(code)),
        ),
      ).toEqual([]);
    });

    it('lists in each error response problem types of the catalog with its status, once each, as Problem Details', () => {
      expect(
        violations((_, operation) =>
          Object.entries(operation.responses)
            .filter(([status]) => Number(status) >= 400)
            .flatMap(([status, response]) => {
              const types = typesOf(response);
              const schema =
                response.content?.['application/problem+json']?.schema?.$ref;
              return [
                ...(types.length > 0 ? [] : [`${status} lists no type`]),
                ...(new Set(types).size === types.length
                  ? []
                  : [`${status} lists a type twice`]),
                ...types
                  .filter(
                    (code) =>
                      !isProblemCode(code) ||
                      PROBLEM_TYPES[code].status !== Number(status),
                  )
                  .map((code) => `${status} lists ${code}`),
                ...(schema === '#/components/schemas/ProblemDetails'
                  ? []
                  : [`${status} is not Problem Details`]),
              ];
            }),
        ),
      ).toEqual([]);
    });

    it('documents authentication and denied access as each route requires', () => {
      expect(
        violations((route, operation) => {
          const { access } = routes[route];
          const problems = problemsOf(operation);
          const bearer = (operation.security ?? []).some(
            (requirement) => 'bearer' in requirement,
          );
          const needs: string[] = [];
          const excludes: string[] = [];
          if (access === 'public') excludes.push('bearer', 'unauthenticated');
          else needs.push('bearer', 'unauthenticated');
          if (Array.isArray(access) || access === 'customer') {
            needs.push('forbidden');
          }
          if (
            Array.isArray(access) ||
            (access === 'account' && !noStaff.has(route))
          ) {
            needs.push('password-change-required');
          }
          if (access === 'account, also with a temporary password') {
            excludes.push('password-change-required');
          }
          if (noStaff.has(route)) needs.push('staff-cannot-purchase');
          const has = (what: string) =>
            what === 'bearer' ? bearer : problems.has(what);
          return [
            ...needs
              .filter((what) => !has(what))
              .map((what) => `without ${what}`),
            ...excludes.filter(has).map((what) => `with ${what}`),
          ];
        }),
      ).toEqual([]);
    });

    it('documents Idempotency-Key and its problems only on the routes that require it', () => {
      expect(
        violations((route, operation) => {
          const idempotent = routes[route].idempotent !== undefined;
          const header = (operation.parameters ?? []).find(
            (parameter) =>
              parameter.in === 'header' &&
              parameter.name === IDEMPOTENCY_KEY_HEADER,
          );
          const problems = problemsOf(operation);
          if (!idempotent) {
            return header === undefined &&
              IDEMPOTENCY_PROBLEMS.every((code) => !problems.has(code))
              ? []
              : ['documents Idempotency-Key'];
          }
          return [
            ...(header?.required === true ? [] : ['without the header']),
            ...IDEMPOTENCY_PROBLEMS.filter((code) => !problems.has(code)),
          ];
        }),
      ).toEqual([]);
    });
  });

  describe(VERSIONED_DOCUMENT, () => {
    it('is the document the application generates (npm run openapi:update writes it)', () => {
      const generated = sortedKeys(document);
      if (process.env.OPENAPI_UPDATE === 'true') {
        writeFileSync(
          VERSIONED_DOCUMENT,
          `${JSON.stringify(generated, null, 2)}\n`,
        );
      }
      const versioned = JSON.parse(
        readFileSync(VERSIONED_DOCUMENT, 'utf8'),
      ) as unknown;

      expect(differences(generated, versioned)).toEqual([]);
    });
  });
});
