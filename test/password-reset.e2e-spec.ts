import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/platform/persistence/prisma.service.js';
import { type EmailMessage, newId } from '../src/shared-kernel/index.js';

const PASSWORD = 'una frase larga y segura';
const NEW_PASSWORD = 'otra frase nueva y segura';
/** The IP budget (10 per hour) is tested apart, in password-reset-limits.e2e-spec.ts. */
const TEST_ENVIRONMENT = { RATE_LIMIT_PASSWORD_RESET_IP: '100/1h' };

/** Password recovery over HTTP (T-123, API_SPEC.md §9.8 and §9.9, ADR-0118). */
describe('Password recovery (e2e, T-123)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let passwordHash: string;
  const sent: EmailMessage[] = [];
  const previous: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const [name, value] of Object.entries(TEST_ENVIRONMENT)) {
      previous[name] = process.env[name];
      process.env[name] = value;
    }
    // AppModule validates the environment when it loads, so import it after setting the variables.
    const { AppModule } = await import('../src/app.module.js');
    const { configureHttp } =
      await import('../src/platform/http/configure-http.js');
    const { PrismaService } =
      await import('../src/platform/persistence/prisma.service.js');
    const { EmailSender } = await import('../src/shared-kernel/index.js');
    const { PasswordHasher } =
      await import('../src/modules/identity-access/application/password-hasher.js');
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(EmailSender)
      .useValue({
        send: (message: EmailMessage) => {
          sent.push(message);
          return Promise.resolve();
        },
      })
      .compile();
    app = moduleFixture.createNestApplication<INestApplication<App>>();
    configureHttp(app);
    await app.init();
    prisma = app.get(PrismaService);
    passwordHash = await app.get(PasswordHasher).hash(PASSWORD);
  });

  afterEach(async () => {
    sent.length = 0;
    await prisma.passwordResetToken.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { action: { in: ['auth.login', 'auth.password-reset'] } },
    });
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

  const http = () => request(app.getHttpServer());
  const requestReset = (email: string) =>
    http().post('/v1/auth/password-reset/request').send({ email });
  const confirm = (token: string, newPassword = NEW_PASSWORD) =>
    http().post('/v1/auth/password-reset/confirm').send({ token, newPassword });
  const login = (email: string, password: string) =>
    http().post('/v1/auth/login').send({ email, password });

  /** The token of the last recovery link sent to `to`. */
  function lastToken(to: string): string {
    const message = sent.filter((email) => email.to === to).at(-1);
    const token = /reset-password\?token=([\w-]+)/.exec(message?.text ?? '');
    if (token === null) throw new Error(`No recovery link to ${to}`);
    return token[1];
  }

  it('answers a request the same whether the email exists or not', async () => {
    const email = await insertCustomer();

    const known = await requestReset(email).expect(202);
    const unknown = await requestReset('nadie@example.com').expect(202);

    expect(known.body).toEqual({});
    expect(unknown.body).toEqual({});
    expect(sent).toEqual([
      expect.objectContaining({
        to: email,
        subject: 'Restablece tu contraseña',
        text: expect.stringContaining(
          'http://localhost:5173/reset-password?token=',
        ),
      }),
    ]);
  });

  it('sets the new password with the link, once, and signs out every session', async () => {
    const email = await insertCustomer();
    const before = (await login(email, PASSWORD).expect(200)).body;
    await requestReset(email).expect(202);
    const token = lastToken(email);

    await confirm(token).expect(204);

    await login(email, PASSWORD).expect(401);
    await login(email, NEW_PASSWORD).expect(200);
    await http()
      .get('/v1/me')
      .set('Authorization', `Bearer ${before.accessToken}`)
      .expect(401);
    const again = await confirm(token).expect(400);
    expect(again.body.type).toBe('/problems/invalid-or-expired-token');
    expect(sent.at(-1)).toMatchObject({
      to: email,
      subject: 'Tu contraseña cambió',
    });
  });

  it('names the password rule that failed, and keeps the link', async () => {
    const email = await insertCustomer();
    await requestReset(email).expect(202);
    const token = lastToken(email);

    const response = await confirm(token, 'corta').expect(400);

    expect(response.body).toMatchObject({
      type: '/problems/password-policy-violation',
      errors: [{ field: 'newPassword', code: 'passwordLength' }],
    });
    await confirm(token).expect(204);
  });

  it('rejects an unknown token and a malformed request', async () => {
    const unknown = await confirm('x'.repeat(43)).expect(400);
    const malformed = await http()
      .post('/v1/auth/password-reset/confirm')
      .send({ token: 'x'.repeat(43) })
      .expect(400);

    expect(unknown.body.type).toBe('/problems/invalid-or-expired-token');
    expect(malformed.body.type).toBe('/problems/validation-error');
  });

  it('takes at most 3 requests per email and hour', async () => {
    for (let call = 0; call < 3; call++) {
      await requestReset('limite@example.com').expect(202);
    }

    const response = await requestReset('LIMITE@example.com').expect(429);

    expect(response.body.type).toBe('/problems/rate-limit-exceeded');
  });
});
