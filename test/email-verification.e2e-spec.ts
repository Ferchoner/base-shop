import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/platform/persistence/prisma.service.js';
import type { EmailMessage } from '../src/shared-kernel/index.js';

const PASSWORD = 'una frase larga y segura';
const SIGN_UP = {
  email: 'Maria@Example.com',
  password: PASSWORD,
  firstNames: 'María',
  lastNames: 'López',
  privacyNoticeVersion: '2026-09',
};
/** This file signs up more than the 5 accounts per IP and hour of the real limit. */
const TEST_ENVIRONMENT = { RATE_LIMIT_REGISTER: '100/1h' };

/** Sign-up, email verification, email change and rectification over HTTP (T-121, API_SPEC.md §9.2 to §9.4, §9.11, §9.13). */
describe('Email verification (e2e, T-121)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
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
  });

  afterEach(async () => {
    sent.length = 0;
    await prisma.emailVerificationToken.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.userRole.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: {
        action: {
          in: ['auth.login', 'auth.email-change', 'customers.rectify'],
        },
      },
    });
    await app.close();
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const register = (body: object = SIGN_UP) =>
    http().post('/v1/auth/register').send(body);
  const confirm = (token: string) =>
    http().post('/v1/auth/email-verification/confirm').send({ token });
  const resend = (email: string) =>
    http().post('/v1/auth/email-verification/resend').send({ email });

  /** The token of the last verification link sent to `to`. */
  function lastToken(to: string): string {
    const message = sent.filter((email) => email.to === to).at(-1);
    const token = /verify-email\?token=([\w-]+)/.exec(message?.text ?? '');
    if (token === null) throw new Error(`No verification link to ${to}`);
    return token[1];
  }

  async function signIn(email: string): Promise<string> {
    const response = await http()
      .post('/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return response.body.accessToken;
  }

  describe('signing up (UC-IAM-01)', () => {
    it('answers 201 with the unverified account, never cached, and sends the link', async () => {
      const response = await register().expect(201);

      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).toEqual({
        id: expect.any(String),
        type: 'CUSTOMER',
        email: 'maria@example.com',
        firstNames: 'María',
        lastNames: 'López',
        emailVerified: false,
        mustChangePassword: false,
        roles: [],
        permissions: [],
        createdAt: expect.any(String),
      });
      expect(sent).toEqual([
        expect.objectContaining({
          to: 'maria@example.com',
          subject: 'Confirma tu correo',
          text: expect.stringContaining(
            'http://localhost:5173/verify-email?token=',
          ),
        }),
      ]);
    });

    it('says when the email is taken (ADR-0062)', async () => {
      await register().expect(201);

      const response = await register({
        ...SIGN_UP,
        email: 'maria@example.com',
      }).expect(409);

      expect(response.body).toMatchObject({
        type: '/problems/duplicate-value',
        field: 'email',
      });
    });

    it('names the password rule that failed', async () => {
      const response = await register({
        ...SIGN_UP,
        password: 'corta',
      }).expect(400);

      expect(response.body).toMatchObject({
        type: '/problems/password-policy-violation',
        errors: [
          {
            field: 'password',
            code: 'passwordLength',
            message: 'Debe tener entre 15 y 64 caracteres.',
          },
        ],
      });
    });

    it.each([
      ['privacyNoticeVersion', { privacyNoticeVersion: undefined }],
      ['firstNames', { firstNames: '   ' }],
      ['email', { email: 'no-es-un-correo' }],
      ['role', { role: 'STAFF' }],
    ])('rejects an invalid %s', async (field, changes) => {
      const response = await register({ ...SIGN_UP, ...changes }).expect(400);

      expect(response.body.errors).toContainEqual(
        expect.objectContaining({ field }),
      );
    });
  });

  describe('confirming and resending (UC-IAM-02, UC-IAM-03)', () => {
    it('verifies the email once with the token of the link', async () => {
      await register().expect(201);
      const token = lastToken('maria@example.com');

      const response = await confirm(token).expect(200);

      expect(response.body).toEqual({ emailVerified: true });
      const me = await http()
        .get('/v1/me')
        .set(bearer(await signIn('maria@example.com')))
        .expect(200);
      expect(me.body.emailVerified).toBe(true);
      const again = await confirm(token).expect(400);
      expect(again.body.type).toBe('/problems/invalid-or-expired-token');
    });

    it('answers a resend the same whether the email exists or not, and the new link replaces the old one', async () => {
      await register().expect(201);
      const first = lastToken('maria@example.com');

      await resend('nadie@example.com').expect(202);
      const response = await resend('maria@example.com').expect(202);

      expect(response.body).toEqual({});
      await confirm(first).expect(400);
      await confirm(lastToken('maria@example.com')).expect(200);
    });
  });

  describe('changing the email (UC-IAM-10)', () => {
    it('answers the account with the new email unverified, and tells both addresses', async () => {
      await register().expect(201);
      await confirm(lastToken('maria@example.com')).expect(200);
      const token = await signIn('maria@example.com');
      sent.length = 0;

      const response = await http()
        .post('/v1/me/email')
        .set(bearer(token))
        .send({ newEmail: 'Nueva@Example.com', currentPassword: PASSWORD })
        .expect(200);

      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).toMatchObject({
        email: 'nueva@example.com',
        emailVerified: false,
      });
      expect(sent.map(({ to, subject }) => ({ to, subject }))).toEqual([
        { to: 'nueva@example.com', subject: 'Confirma tu correo' },
        { to: 'maria@example.com', subject: 'Tu correo cambió' },
      ]);
    });

    it('answers a wrong password, the same email and a taken one', async () => {
      await register().expect(201);
      await register({ ...SIGN_UP, email: 'otra@example.com' }).expect(201);
      const token = await signIn('maria@example.com');
      const change = (body: object) =>
        http().post('/v1/me/email').set(bearer(token)).send(body);

      const wrong = await change({
        newEmail: 'nueva@example.com',
        currentPassword: `${PASSWORD}!`,
      }).expect(401);
      const same = await change({
        newEmail: 'MARIA@example.com',
        currentPassword: PASSWORD,
      }).expect(400);
      const taken = await change({
        newEmail: 'otra@example.com',
        currentPassword: PASSWORD,
      }).expect(409);

      expect(wrong.body.type).toBe('/problems/invalid-credentials');
      expect(same.body.errors).toEqual([
        {
          field: 'newEmail',
          code: 'sameEmail',
          message: 'Es el correo que ya tienes.',
        },
      ]);
      expect(taken.body).toMatchObject({ field: 'email' });
    });
  });

  describe('rectifying (ADR-0067)', () => {
    it('changes only the names sent', async () => {
      await register().expect(201);
      const token = await signIn('maria@example.com');

      const response = await http()
        .patch('/v1/me')
        .set(bearer(token))
        .send({ lastNames: 'López Hernández' })
        .expect(200);

      expect(response.body).toMatchObject({
        firstNames: 'María',
        lastNames: 'López Hernández',
      });
    });

    it('rejects clearing a name with null', async () => {
      await register().expect(201);
      const token = await signIn('maria@example.com');

      const response = await http()
        .patch('/v1/me')
        .set(bearer(token))
        .send({ firstNames: null })
        .expect(400);

      expect(response.body.errors).toContainEqual(
        expect.objectContaining({ field: 'firstNames' }),
      );
    });
  });

  describe('limits (ADR-0065, ADR-0102)', () => {
    it('sends at most 3 verification emails per email and hour', async () => {
      for (let call = 0; call < 3; call++) {
        await resend('limite@example.com').expect(202);
      }

      const response = await resend('LIMITE@example.com').expect(429);

      expect(response.body.type).toBe('/problems/rate-limit-exceeded');
    });

    it('takes at most 3 email changes per customer and hour', async () => {
      await register({ ...SIGN_UP, email: 'cambios@example.com' }).expect(201);
      const token = await signIn('cambios@example.com');
      const change = () =>
        http()
          .post('/v1/me/email')
          .set(bearer(token))
          .send({ newEmail: 'x@example.com', currentPassword: `${PASSWORD}!` });

      for (let call = 0; call < 3; call++) await change().expect(401);

      await change().expect(429);
    });
  });

  it('keeps staff out of the customer routes', async () => {
    const { PasswordHasher } =
      await import('../src/modules/identity-access/application/password-hasher.js');
    await prisma.user.create({
      data: {
        id: '01a0ef00-0000-7000-8000-000000000001',
        type: 'STAFF',
        email: 'staff@example.com',
        firstNames: 'Luis',
        lastNames: 'García',
        passwordHash: await app.get(PasswordHasher).hash(PASSWORD),
        roles: {
          create: [{ roleId: '01a0ea00-c755-706d-9721-83f80a3d8630' }],
        },
      },
    });
    const token = await signIn('staff@example.com');

    await http()
      .patch('/v1/me')
      .set(bearer(token))
      .send({ firstNames: 'Otro' })
      .expect(403);
    await http()
      .post('/v1/me/email')
      .set(bearer(token))
      .send({ newEmail: 'otro@example.com', currentPassword: PASSWORD })
      .expect(403);
  });
});
