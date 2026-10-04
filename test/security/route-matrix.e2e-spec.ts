import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../../src/app.module.js';
import type { AuthenticatedUser } from '../../src/platform/auth/authenticated-user.js';
import { configureHttp } from '../../src/platform/http/configure-http.js';
import { PrismaService } from '../../src/platform/persistence/prisma.service.js';
import { newId, PERMISSION_CODES } from '../../src/shared-kernel/index.js';
import {
  routeInventory,
  type RouteSecurity,
} from '../support/route-inventory.js';
import {
  signedInAs,
  useTestAuthentication,
} from '../support/test-authentication.js';
import { ROUTE_MATRIX } from './route-matrix.js';

/**
 * How every route of the API is protected (T-310, ADR-0153): the decorators of the running application against the
 * reviewed matrix, and a request to each protected route without the right credentials.
 */
describe('Route matrix (e2e, T-310)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let routes: Record<string, RouteSecurity>;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication<INestApplication<App>>();
    useTestAuthentication(app);
    configureHttp(app);
    await app.init();
    prisma = app.get(PrismaService);
    routes = routeInventory(app);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { action: 'http.access-denied' },
    });
    await app.close();
  });

  const staff = (...permissions: string[]): AuthenticatedUser =>
    ({
      id: newId(),
      type: 'STAFF',
      permissions,
      mustChangePassword: false,
      sessionId: newId(),
    }) as AuthenticatedUser;
  const customer: AuthenticatedUser = {
    id: newId(),
    type: 'CUSTOMER',
    permissions: [],
    mustChangePassword: false,
    sessionId: newId(),
  };

  /** A request to the route, with made-up identifiers in its path. */
  const call = (route: string) => {
    const [method, path] = route.split(' ');
    const url = path
      .replace(':publicCode', 'K7M4Q9XA')
      .replace(/:[A-Za-z]+/g, () => newId());
    const server = request(app.getHttpServer());
    const verb = method.toLowerCase() as
      'get' | 'post' | 'put' | 'patch' | 'delete';
    return server[verb](url).send({});
  };

  const where = (test: (path: string, security: RouteSecurity) => boolean) =>
    Object.entries(routes)
      .filter(([route, security]) => test(route.split(' ')[1], security))
      .map(([route]) => route);

  it('declares how every route is protected, as reviewed', () => {
    const changed = Object.keys(routes).filter(
      (route) =>
        route in ROUTE_MATRIX &&
        JSON.stringify(routes[route]) !== JSON.stringify(ROUTE_MATRIX[route]),
    );

    // A difference means a route to review, and then to write in route-matrix.ts (DEVELOPMENT_GUIDE.md).
    expect({
      new: Object.keys(routes).filter((route) => !(route in ROUTE_MATRIX)),
      gone: Object.keys(ROUTE_MATRIX).filter((route) => !(route in routes)),
      changed: changed.map((route) => ({
        route,
        declared: routes[route],
        reviewed: ROUTE_MATRIX[route],
      })),
    }).toEqual({ new: [], gone: [], changed: [] });
  });

  it('asks staff with permissions of the catalog for every administrative route, and an account for every route of /me (ADR-0111)', () => {
    for (const route of where((path) => path.startsWith('/v1/admin/'))) {
      const { access } = routes[route];
      expect({ route, access }).toEqual({ route, access: expect.any(Array) });
      for (const code of access as string[]) {
        expect(PERMISSION_CODES).toContain(code);
      }
    }
    for (const route of where((path) => /^\/v1\/me(\/|$)/.test(path))) {
      expect({ route, access: routes[route].access }).toEqual({
        route,
        access: expect.stringMatching(/^(account|customer)/),
      });
    }
    expect(
      where(
        (path, { access }) =>
          Array.isArray(access) && !path.startsWith('/v1/admin/'),
      ),
    ).toEqual([]);
  });

  it('answers 401 without a token, and no-store, to every route that needs one', async () => {
    const answers: string[] = [];
    for (const route of where((_, { access }) => access !== 'public')) {
      const response = await call(route);
      if (
        response.status !== 401 ||
        response.headers['cache-control'] !== 'no-store'
      ) {
        answers.push(
          `${route}: ${response.status} ${response.headers['cache-control']}`,
        );
      }
    }

    expect(answers).toEqual([]);
  });

  it('answers 403 to staff without the permissions and to customers, on every administrative route (BFLA)', async () => {
    const answers: string[] = [];
    for (const route of where((path) => path.startsWith('/v1/admin/'))) {
      const { access } = routes[route];
      // Every other permission, but the ones the route asks for.
      const others = PERMISSION_CODES.filter(
        (code) => !(access as string[]).includes(code),
      );
      for (const user of [staff(...others), customer]) {
        const response = await call(route).set(signedInAs(user));
        if (response.status !== 403) {
          answers.push(`${route} as ${user.type}: ${response.status}`);
        }
      }
    }

    expect(answers).toEqual([]);
  });

  it('answers 403 to staff on every route only for customers', async () => {
    const answers: string[] = [];
    for (const route of where((_, { access }) => access === 'customer')) {
      const response = await call(route).set(signedInAs(staff()));
      if (response.status !== 403) {
        answers.push(`${route}: ${response.status}`);
      }
    }

    expect(answers).toEqual([]);
  });
});
