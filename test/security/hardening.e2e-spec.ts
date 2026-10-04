import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../../src/app.module.js';
import type { AuthenticatedUser } from '../../src/platform/auth/authenticated-user.js';
import { configureHttp } from '../../src/platform/http/configure-http.js';
import { PrismaService } from '../../src/platform/persistence/prisma.service.js';
import { EmailSender, newId } from '../../src/shared-kernel/index.js';
import {
  signedInAs,
  useTestAuthentication,
} from '../support/test-authentication.js';

/** The fixes of the security audit that need the whole application (T-310, docs/SECURITY_AUDIT.md). */
describe('Security hardening (e2e, T-310)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(EmailSender)
      .useValue({ send: () => Promise.resolve() })
      .compile();
    app = moduleFixture.createNestApplication<INestApplication<App>>();
    useTestAuthentication(app);
    configureHttp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: {
        action: { in: ['http.access-denied', 'auth.login', 'auth.register'] },
      },
    });
    await prisma.refreshToken.deleteMany();
    await prisma.emailVerificationToken.deleteMany();
    await prisma.cartLine.deleteMany();
    await prisma.cart.deleteMany();
    await prisma.user.deleteMany();
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const user = (
    type: 'STAFF' | 'CUSTOMER',
    ...permissions: string[]
  ): AuthenticatedUser =>
    ({
      id: newId(),
      type,
      permissions,
      mustChangePassword: false,
      sessionId: newId(),
    }) as AuthenticatedUser;
  const nested = (depth: number) => `${'['.repeat(depth)}${']'.repeat(depth)}`;

  it('never lets a guest answer with personal data or a cart be stored, errors included (SA-06)', async () => {
    const created = await http().post('/v1/carts').expect(201);
    const answers = [
      created,
      await http().get(`/v1/carts/${randomUUID()}`).expect(404),
      await http()
        .post('/v1/checkout/quote')
        .send({ cartId: randomUUID() })
        .expect(404),
      await http()
        .post('/v1/orders/lookup')
        .send({ contactEmail: 'cliente@example.com', publicCode: 'K7M4Q9XA' })
        .expect(404),
    ];

    expect(answers.map((answer) => answer.headers['cache-control'])).toEqual([
      'no-store',
      'no-store',
      'no-store',
      'no-store',
    ]);
  });

  it('audits a 403 of an administrative route reached in another case, as Express routes it (SA-07)', async () => {
    const denied = () =>
      prisma.auditLog.count({ where: { action: 'http.access-denied' } });
    const before = await denied();

    await http()
      .get('/V1/Admin/audit')
      .set(signedInAs(user('CUSTOMER')))
      .expect(403);

    expect(await denied()).toBe(before + 1);
  });

  it('answers a body of another media type with the security headers and without X-Powered-By (SA-08)', async () => {
    const response = await http()
      .post('/v1/carts')
      .set('Content-Type', 'text/plain')
      .send('x')
      .expect(415);

    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers).toMatchObject({
      'content-security-policy': "default-src 'none';frame-ancestors 'none'",
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
    });
  });

  it('answers 400 to a page past the last one allowed, and to a stock quantity past an integer, never 500 (SA-09)', async () => {
    const reader = user('STAFF', 'catalog.read', 'inventory.read');

    await http().get('/v1/catalog/products?page=1000000').expect(200);
    for (const page of ['1000001', '1e21']) {
      const { body } = await http()
        .get(`/v1/catalog/products?page=${page}`)
        .expect(400);
      expect(body.errors).toEqual([expect.objectContaining({ field: 'page' })]);
      await http()
        .get(`/v1/admin/catalog/brands?page=${page}`)
        .set(signedInAs(reader))
        .expect(400);
    }
    await http()
      .get('/v1/admin/inventory/stock-items?availableMax=2147483648')
      .set(signedInAs(reader))
      .expect(400);
  });

  it('answers 400 to a JSON body nested too deep, on any route and before an idempotent one keeps it, never 500 (SA-10)', async () => {
    const deep = `{"cartId":"${randomUUID()}","x":${nested(40)}}`;
    const send = (path: string, body: string) =>
      http()
        .post(path)
        .set('Content-Type', 'application/json')
        .set('Idempotency-Key', randomUUID())
        .send(body);

    for (const path of ['/v1/checkout/quote', '/v1/orders']) {
      const { body } = await send(path, deep).expect(400);
      expect(body).toMatchObject({ type: '/problems/validation-error' });
      expect(body.errors).toBeUndefined();
    }
    // Within the limit, the body reaches validation, which rejects the undeclared field.
    const { body } = await send(
      '/v1/checkout/quote',
      `{"cartId":"${randomUUID()}","x":${nested(31)}}`,
    ).expect(400);
    expect(body.errors).toEqual([expect.objectContaining({ field: 'x' })]);
  });

  it('bounds the text and the lists of the administrative filters (SA-11)', async () => {
    const admin = user(
      'STAFF',
      'staff.manage',
      'customers.read',
      'inventory.read',
    );
    const get = (path: string) => http().get(path).set(signedInAs(admin));

    for (const [path, longest] of [
      ['/v1/admin/identity/roles?q=', 100],
      ['/v1/admin/identity/staff?q=', 254],
      ['/v1/admin/identity/customers?q=', 254],
      ['/v1/admin/inventory/stock-items?q=', 100],
      ['/v1/admin/inventory/stock-items?sku=', 64],
    ] as const) {
      await get(`${path}${'a'.repeat(longest)}`).expect(200);
      await get(`${path}${'a'.repeat(longest + 1)}`).expect(400);
    }
    const { body } = await http()
      .put(`/v1/admin/identity/staff/${newId()}/roles`)
      .set(signedInAs(admin))
      .send({ roleIds: Array.from({ length: 51 }, () => newId()), version: 1 })
      .expect(400);
    expect(body.errors).toEqual([
      expect.objectContaining({ field: 'roleIds' }),
    ]);
  });

  it('signs in with a password typed in a decomposed form, as it was registered (SA-12)', async () => {
    // 40 accented letters: 40 characters in NFKC, which the policy counts, and 80 as typed.
    const password = 'e\u0301'.repeat(40);
    const email = `${newId()}@example.com`;
    await http()
      .post('/v1/auth/register')
      .send({
        email,
        password,
        firstNames: 'Ana',
        lastNames: 'Pérez',
        privacyNoticeVersion: '2026-09',
      })
      .expect(201);

    await http().post('/v1/auth/login').send({ email, password }).expect(200);
  });
});
