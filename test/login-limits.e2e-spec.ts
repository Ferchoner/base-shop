import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/platform/persistence/prisma.service.js';
import { newId } from '../src/shared-kernel/index.js';

const PASSWORD = 'una frase larga y segura';
/** A small limit, so it is reached in a few requests. */
const TEST_LIMITS = { RATE_LIMIT_LOGIN_IP: '4/15m' };

/**
 * Failed sign-ins are limited per IP; successful ones spend nothing, and the failures of an email never keep its
 * owner out (T-120, ADR-0065, ADR-0102, ADR-0154). The tests share one budget per IP, so they run in order.
 */
describe('Sign-in limits (e2e, T-120)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let passwordHash: string;
  const previous: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const [name, value] of Object.entries(TEST_LIMITS)) {
      previous[name] = process.env[name];
      process.env[name] = value;
    }
    // AppModule validates the environment when it loads, so import it after setting the limits.
    const { AppModule } = await import('../src/app.module.js');
    const { configureHttp } =
      await import('../src/platform/http/configure-http.js');
    const { PrismaService } =
      await import('../src/platform/persistence/prisma.service.js');
    const { PasswordHasher } =
      await import('../src/modules/identity-access/application/password-hasher.js');
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication<INestApplication<App>>();
    configureHttp(app);
    await app.init();
    prisma = app.get(PrismaService);
    passwordHash = await app.get(PasswordHasher).hash(PASSWORD);
  });

  afterAll(async () => {
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
    await prisma.auditLog.deleteMany({ where: { action: 'auth.login' } });
    await app.close();
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  async function insertCustomer(): Promise<string> {
    const id = newId();
    const email = `${id}@example.com`;
    await prisma.user.create({
      data: {
        id,
        type: 'CUSTOMER',
        email,
        firstNames: 'Ana',
        lastNames: 'Pérez',
        passwordHash,
      },
    });
    return email;
  }

  const login = (email: string, password = PASSWORD) =>
    request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email, password });

  function expectLimited(response: request.Response): void {
    expect(response.status).toBe(429);
    expect(response.body.type).toBe('/problems/rate-limit-exceeded');
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
  }

  it('never counts successful sign-ins', async () => {
    const email = await insertCustomer();

    for (let call = 0; call < 3; call++) await login(email).expect(200);
  });

  it('never keeps the owner out because of the failures of their email (SA-04)', async () => {
    const email = await insertCustomer();
    await login(email, 'otra frase equivocada').expect(401);
    await login(email.toUpperCase(), 'otra frase equivocada').expect(401);
    await login(email, 'otra frase equivocada').expect(401);

    await login(email).expect(200);
  });

  it('stops an IP after its failures, whatever the email, and says when to retry', async () => {
    // Three failures from the previous test count against the same IP (4 in 15 minutes).
    await login('uno@example.com', 'otra frase equivocada').expect(401);

    expectLimited(await login(await insertCustomer()));
    expectLimited(await login('dos@example.com', 'otra frase equivocada'));
  });
});
