import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import type { AuthenticatedUser } from '../src/platform/auth/authenticated-user.js';
import { configureHttp } from '../src/platform/http/configure-http.js';
import { PrismaService } from '../src/platform/persistence/prisma.service.js';
import {
  AccountAuthorizationSampleController,
  AdminAuthorizationSampleController,
  PublicAuthorizationSampleController,
} from './fixtures/authorization-sample.controller.js';
import {
  signedInAs,
  useTestAuthentication,
} from './support/test-authentication.js';

const CUSTOMER: AuthenticatedUser = {
  id: '01a0eb00-0000-7000-8000-000000000001',
  type: 'CUSTOMER',
  permissions: [],
  mustChangePassword: false,
  sessionId: '01a0eb00-0000-7000-8000-000000000011',
};
const STAFF_READER: AuthenticatedUser = {
  id: '01a0eb00-0000-7000-8000-000000000002',
  type: 'STAFF',
  permissions: ['customers.read'],
  mustChangePassword: false,
  sessionId: '01a0eb00-0000-7000-8000-000000000012',
};
const STAFF_MANAGER: AuthenticatedUser = {
  ...STAFF_READER,
  permissions: ['customers.read', 'customers.manage'],
};
const STAFF_WITH_TEMPORARY_PASSWORD: AuthenticatedUser = {
  ...STAFF_MANAGER,
  mustChangePassword: true,
};

/** Authorization of the route groups (T-130, ADR-0111, API_SPEC.md §3.2) and listings (ADR-0036). */
describe('Authorization (e2e, T-130)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [
        AdminAuthorizationSampleController,
        AccountAuthorizationSampleController,
        PublicAuthorizationSampleController,
      ],
    }).compile();
    app = moduleFixture.createNestApplication<INestApplication<App>>();
    useTestAuthentication(app);
    configureHttp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { action: 'http.access-denied' },
    });
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  async function expectProblem(
    response: request.Response,
    status: number,
    type: string,
  ): Promise<void> {
    expect(response.status).toBe(status);
    expect(response.headers['content-type']).toMatch(
      /application\/problem\+json/,
    );
    expect(response.body.type).toBe(`/problems/${type}`);
  }

  it('leaves public routes open, and cacheable', async () => {
    const response = await http()
      .get('/v1/test-authorization-public')
      .expect(200);

    expect(response.headers['cache-control']).not.toBe('no-store');
  });

  describe('administrative routes (/v1/admin)', () => {
    it('answers 401 unauthenticated without a signed-in user', async () => {
      await expectProblem(
        await http().get('/v1/admin/test-authorization'),
        401,
        'unauthenticated',
      );
    });

    it('treats a malformed user as signed out', async () => {
      const response = await http()
        .get('/v1/admin/test-authorization')
        .set('x-test-user', JSON.stringify({ id: 'x', type: 'STAFF' }));

      await expectProblem(response, 401, 'unauthenticated');
    });

    it('answers 403 forbidden to a customer, and audits it', async () => {
      const response = await http()
        .get('/v1/admin/test-authorization')
        .set(signedInAs(CUSTOMER));

      await expectProblem(response, 403, 'forbidden');
      const entry = await prisma.auditLog.findFirst({
        where: { action: 'http.access-denied', actorId: CUSTOMER.id },
      });
      expect(entry).toMatchObject({ actorType: 'USER', result: 'DENIED' });
    });

    it('answers 403 forbidden to staff without every required permission', async () => {
      await expectProblem(
        await http()
          .get('/v1/admin/test-authorization/both')
          .set(signedInAs(STAFF_READER)),
        403,
        'forbidden',
      );
    });

    it('lets staff with every required permission in', async () => {
      await http()
        .get('/v1/admin/test-authorization')
        .set(signedInAs(STAFF_READER))
        .expect(200, { ok: true });
      await http()
        .get('/v1/admin/test-authorization/both')
        .set(signedInAs(STAFF_MANAGER))
        .expect(200, { ok: true });
    });

    it('answers 403 password-change-required while staff has a temporary password', async () => {
      await expectProblem(
        await http()
          .get('/v1/admin/test-authorization')
          .set(signedInAs(STAFF_WITH_TEMPORARY_PASSWORD)),
        403,
        'password-change-required',
      );
    });

    it('fails closed on an administrative route that declares no requirement', async () => {
      const response = await http()
        .get('/v1/admin/test-authorization/forgotten')
        .set(signedInAs(STAFF_MANAGER));

      await expectProblem(response, 500, 'internal-error');
    });

    it('fails closed on a route without a requirement reached in another case, as Express routes it (T-310)', async () => {
      for (const path of [
        '/V1/Admin/test-authorization/forgotten',
        '/v1/me/test-authorization/forgotten',
        '/V1/ME/test-authorization/forgotten',
      ]) {
        const response = await http().get(path).set(signedInAs(STAFF_MANAGER));

        await expectProblem(response, 500, 'internal-error');
      }
    });
  });

  describe('account routes (/v1/me)', () => {
    it('answers 401 unauthenticated without a signed-in user', async () => {
      await expectProblem(
        await http().get('/v1/me/test-authorization'),
        401,
        'unauthenticated',
      );
    });

    it('lets any account in', async () => {
      await http()
        .get('/v1/me/test-authorization')
        .set(signedInAs(CUSTOMER))
        .expect(200);
      await http()
        .get('/v1/me/test-authorization')
        .set(signedInAs(STAFF_READER))
        .expect(200);
    });

    it('answers 403 forbidden to staff on a customer-only route', async () => {
      await http()
        .get('/v1/me/test-authorization/customer')
        .set(signedInAs(CUSTOMER))
        .expect(200);
      await expectProblem(
        await http()
          .get('/v1/me/test-authorization/customer')
          .set(signedInAs(STAFF_READER)),
        403,
        'forbidden',
      );
    });

    it('only lets staff with a temporary password into the routes that allow it', async () => {
      await expectProblem(
        await http()
          .get('/v1/me/test-authorization')
          .set(signedInAs(STAFF_WITH_TEMPORARY_PASSWORD)),
        403,
        'password-change-required',
      );
      await http()
        .get('/v1/me/test-authorization/password')
        .set(signedInAs(STAFF_WITH_TEMPORARY_PASSWORD))
        .expect(200);
    });
  });

  describe('listings (ADR-0036)', () => {
    const list = (query: string) =>
      http()
        .get(`/v1/admin/test-authorization/items${query}`)
        .set(signedInAs(STAFF_READER));

    it('answers data and meta, sorted by the default field', async () => {
      const response = await list('').expect(200);

      expect(response.body).toEqual({
        data: [
          { name: 'Alfa', createdAt: '2026-09-03' },
          { name: 'Beta', createdAt: '2026-09-02' },
          { name: 'Gamma', createdAt: '2026-09-01' },
        ],
        meta: { page: 1, pageSize: 20, totalItems: 3, totalPages: 1 },
      });
    });

    it('pages and sorts as asked', async () => {
      const response = await list('?sort=-name&page=2&pageSize=2').expect(200);

      expect(response.body).toEqual({
        data: [{ name: 'Alfa', createdAt: '2026-09-03' }],
        meta: { page: 2, pageSize: 2, totalItems: 3, totalPages: 2 },
      });
    });

    it.each([
      ['?pageSize=101', 'pageSize'],
      ['?sort=email', 'sort'],
      ['?status=ACTIVE', 'status'],
    ])('rejects %s', async (query, field) => {
      const response = await list(query);

      await expectProblem(response, 400, 'validation-error');
      expect(response.body.errors).toEqual([
        expect.objectContaining({ field }),
      ]);
    });
  });
});
