import { Controller, type INestApplication, Post } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { RateLimit } from '../src/platform/http/rate-limiting/rate-limit.decorator.js';
import type { PrismaService } from '../src/platform/persistence/prisma.service.js';
import { newId } from '../src/shared-kernel/index.js';

const PASSWORD = 'una frase larga y segura';
/** A known key, so the tests can forge tokens; the API itself never has a fixed one. */
const SECRET = 'e2e-only-signing-key-'.padEnd(40, 'x');
const TEST_ENVIRONMENT = {
  JWT_SECRET: SECRET,
  RATE_LIMIT_PLACE_ORDER: '2/10m',
};
/** Roles of the migration `20260928120000_identity_initial_roles` (ADR-0043). */
const SUPERADMIN = '01a0ea00-c750-7792-a69b-a7289f1a8f47';
const OPERATOR = '01a0ea00-c755-706d-9721-83f80a3d8630';

/** A public route limited per user, standing in for placing an order (ADR-0102). */
@Controller()
class PerUserLimitTestController {
  @Post('test-auth/orders')
  @RateLimit('place-order')
  place() {
    return { ok: true };
  }
}

/** Sign-in, renewal, sign-out and the access token over HTTP (T-120, API_SPEC.md §3, §9.5 to §9.7, §9.10). */
describe('Authentication (e2e, T-120)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let passwordHash: string;
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
    const { PasswordHasher } =
      await import('../src/modules/identity-access/application/password-hasher.js');
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [PerUserLimitTestController],
    }).compile();
    app = moduleFixture.createNestApplication<INestApplication<App>>();
    configureHttp(app);
    await app.init();
    prisma = app.get(PrismaService);
    passwordHash = await app.get(PasswordHasher).hash(PASSWORD);
  });

  afterEach(async () => {
    await prisma.refreshToken.deleteMany();
    await prisma.userRole.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: {
        action: {
          in: [
            'auth.login',
            'auth.logout',
            'auth.refresh-token-reuse',
            'customers.suspend',
            'http.access-denied',
          ],
        },
      },
    });
    await app.close();
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  async function insertUser(
    type: 'CUSTOMER' | 'STAFF' = 'CUSTOMER',
    options: {
      roleIds?: string[];
      status?: 'ACTIVE' | 'SUSPENDED';
      mustChangePassword?: boolean;
    } = {},
  ): Promise<{ id: string; email: string }> {
    const id = newId();
    const email = `${id}@example.com`;
    await prisma.user.create({
      data: {
        id,
        type,
        status: options.status ?? 'ACTIVE',
        suspendedAt: options.status === 'SUSPENDED' ? new Date() : null,
        email,
        firstNames: 'Ana',
        lastNames: 'Pérez',
        passwordHash,
        mustChangePassword: options.mustChangePassword ?? false,
        roles: {
          create: (options.roleIds ?? []).map((roleId) => ({ roleId })),
        },
      },
    });
    return { id, email };
  }

  const http = () => request(app.getHttpServer());
  const login = (email: string, password = PASSWORD) =>
    http().post('/v1/auth/login').send({ email, password });
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const me = (token: string) => http().get('/v1/me').set(bearer(token));

  /** Signs in and returns the pair. */
  async function signIn(
    email: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const response = await login(email).expect(200);
    return response.body;
  }

  function claimsOf(token: string): Record<string, unknown> {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  }

  describe('signing in (UC-IAM-04)', () => {
    it('answers the AuthResult, never cached, with an access token carrying only the user and the session', async () => {
      const customer = await insertUser();

      const response = await login(customer.email.toUpperCase()).expect(200);

      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).toEqual({
        outcome: 'AUTHENTICATED',
        accessToken: expect.stringMatching(/^[\w-]+\.[\w-]+\.[\w-]+$/),
        accessTokenExpiresIn: 900,
        refreshToken: expect.stringMatching(/^rt_[\w-]{43}$/),
        refreshTokenExpiresIn: 604_800,
        tokenType: 'Bearer',
        mustChangePassword: false,
      });
      const [header] = response.body.accessToken.split('.');
      expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({
        alg: 'HS256',
        typ: 'JWT',
      });
      const claims = claimsOf(response.body.accessToken);
      expect(Object.keys(claims).sort()).toEqual(['exp', 'iat', 'sid', 'sub']);
      expect(claims.sub).toBe(customer.id);
      expect(Number(claims.exp) - Number(claims.iat)).toBe(900);
    });

    it('answers a wrong password, an unknown email and a suspended account the same way (ADR-0062)', async () => {
      const customer = await insertUser();
      const suspended = await insertUser('CUSTOMER', { status: 'SUSPENDED' });

      const answers = await Promise.all([
        login(customer.email, `${PASSWORD}!`),
        login('nadie@example.com'),
        login(suspended.email),
      ]);

      for (const answer of answers) {
        expect(answer.status).toBe(401);
        expect(answer.body).toMatchObject({
          type: '/problems/invalid-credentials',
          title: 'Credenciales no válidas',
          detail: 'No se pudo iniciar sesión con los datos proporcionados.',
        });
      }
    });

    it.each([
      [{ email: 'no-es-un-correo', password: PASSWORD }, 'email', 'isEmail'],
      [{ email: 'ana@example.com' }, 'password', expect.any(String)],
      [
        { email: 'ana@example.com', password: 'x'.repeat(65) },
        'password',
        'maxLength',
      ],
      [
        { email: 'ana@example.com', password: PASSWORD, remember: true },
        'remember',
        'whitelistValidation',
      ],
    ])('rejects a malformed request %#', async (body, field, code) => {
      const response = await http()
        .post('/v1/auth/login')
        .send(body)
        .expect(400);

      expect(response.body.errors).toContainEqual(
        expect.objectContaining({ field, code }),
      );
    });

    it('signs in a staff member with a temporary password, who may only see their account and sign out', async () => {
      const staff = await insertUser('STAFF', {
        roleIds: [OPERATOR],
        mustChangePassword: true,
      });

      const response = await login(staff.email).expect(200);
      const { accessToken, refreshToken } = response.body;

      expect(response.body.mustChangePassword).toBe(true);
      expect((await me(accessToken).expect(200)).body).toMatchObject({
        type: 'STAFF',
        mustChangePassword: true,
        roles: [{ id: OPERATOR, name: 'Operador' }],
      });
      const blocked = await http()
        .get('/v1/admin/identity/customers')
        .set(bearer(accessToken))
        .expect(403);
      expect(blocked.body.type).toBe('/problems/password-change-required');
      await http()
        .post('/v1/auth/logout')
        .set(bearer(accessToken))
        .send({ refreshToken })
        .expect(204);
    });
  });

  describe('my account (API_SPEC.md §9.10)', () => {
    it('answers the signed-in customer, never cached', async () => {
      const customer = await insertUser();
      const { accessToken } = await signIn(customer.email);

      const response = await me(accessToken).expect(200);

      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).toEqual({
        id: customer.id,
        type: 'CUSTOMER',
        email: customer.email,
        firstNames: 'Ana',
        lastNames: 'Pérez',
        emailVerified: false,
        mustChangePassword: false,
        roles: [],
        permissions: [],
        createdAt: expect.any(String),
      });
    });

    it('answers a staff member with their roles and permissions', async () => {
      const staff = await insertUser('STAFF', { roleIds: [OPERATOR] });
      const { accessToken } = await signIn(staff.email);

      const response = await me(accessToken).expect(200);

      expect(response.body.roles).toEqual([{ id: OPERATOR, name: 'Operador' }]);
      expect(response.body.permissions).toContain('customers.read');
      expect(response.body.permissions).not.toContain('staff.manage');
    });

    it('needs an access token', async () => {
      const response = await http().get('/v1/me').expect(401);

      expect(response.body.type).toBe('/problems/unauthenticated');
    });
  });

  describe('renewing (UC-IAM-05)', () => {
    it('gives a new pair, never cached, and the used refresh token stops working', async () => {
      const customer = await insertUser();
      const first = await signIn(customer.email);

      const renewed = await http()
        .post('/v1/auth/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(200);

      expect(renewed.headers['cache-control']).toBe('no-store');
      expect(renewed.body).toMatchObject({
        outcome: 'AUTHENTICATED',
        tokenType: 'Bearer',
      });
      expect(renewed.body.refreshToken).not.toBe(first.refreshToken);
      await me(renewed.body.accessToken).expect(200);
      expect(claimsOf(renewed.body.accessToken).sid).toBe(
        claimsOf(first.accessToken).sid,
      );
    });

    it('revokes the whole session when a used refresh token comes back', async () => {
      const customer = await insertUser();
      const first = await signIn(customer.email);
      const renewed = (
        await http()
          .post('/v1/auth/refresh')
          .send({ refreshToken: first.refreshToken })
          .expect(200)
      ).body;

      const reuse = await http()
        .post('/v1/auth/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(401);

      expect(reuse.body.type).toBe('/problems/invalid-refresh-token');
      await me(renewed.accessToken).expect(401);
      await http()
        .post('/v1/auth/refresh')
        .send({ refreshToken: renewed.refreshToken })
        .expect(401);
    });

    it('rejects an unknown refresh token, and a missing one as malformed', async () => {
      await http()
        .post('/v1/auth/refresh')
        .send({ refreshToken: `rt_${'x'.repeat(43)}` })
        .expect(401);
      await http().post('/v1/auth/refresh').send({}).expect(400);
    });
  });

  describe('signing out (UC-IAM-06)', () => {
    it('ends the session at once: its access and refresh tokens stop working', async () => {
      const customer = await insertUser();
      const { accessToken, refreshToken } = await signIn(customer.email);

      await http()
        .post('/v1/auth/logout')
        .set(bearer(accessToken))
        .send({ refreshToken })
        .expect(204);

      await me(accessToken).expect(401);
      await http().post('/v1/auth/refresh').send({ refreshToken }).expect(401);
    });

    it("answers the same for another user's refresh token, which keeps working, and on repeats", async () => {
      const customer = await insertUser();
      const other = await insertUser();
      const mine = await signIn(customer.email);
      const theirs = await signIn(other.email);
      const second = await signIn(customer.email);

      await http()
        .post('/v1/auth/logout')
        .set(bearer(mine.accessToken))
        .send({ refreshToken: theirs.refreshToken })
        .expect(204);
      await me(theirs.accessToken).expect(200);

      for (let call = 0; call < 2; call++) {
        await http()
          .post('/v1/auth/logout')
          .set(bearer(second.accessToken))
          .send({ refreshToken: mine.refreshToken })
          .expect(204);
      }
      await me(mine.accessToken).expect(401);
      await me(second.accessToken).expect(200);
    });

    it('needs an access token', async () => {
      await http()
        .post('/v1/auth/logout')
        .send({ refreshToken: `rt_${'x'.repeat(43)}` })
        .expect(401);
    });
  });

  describe('the access token (ADR-0114)', () => {
    it('grants the permissions the roles have now, not when it was issued', async () => {
      const staff = await insertUser('STAFF', { roleIds: [OPERATOR] });
      const { accessToken } = await signIn(staff.email);
      const roles = () =>
        http().get('/v1/admin/identity/roles').set(bearer(accessToken));

      await roles().expect(403);
      await prisma.userRole.update({
        where: { userId_roleId: { userId: staff.id, roleId: OPERATOR } },
        data: { roleId: SUPERADMIN },
      });

      await roles().expect(200);
    });

    it('stops working as soon as the account is suspended, and so does its refresh token', async () => {
      const admin = await insertUser('STAFF', { roleIds: [SUPERADMIN] });
      const customer = await insertUser();
      const adminTokens = await signIn(admin.email);
      const customerTokens = await signIn(customer.email);

      await http()
        .post(`/v1/admin/identity/customers/${customer.id}/suspend`)
        .set(bearer(adminTokens.accessToken))
        .send({ reason: 'Fraude reportado', version: 1 })
        .expect(200);

      await me(customerTokens.accessToken).expect(401);
      await http()
        .post('/v1/auth/refresh')
        .send({ refreshToken: customerTokens.refreshToken })
        .expect(401);
    });

    describe('rejects a token that is not a valid access token', () => {
      const jwt = new JwtService();

      async function validClaims(): Promise<{ sub: string; sid: string }> {
        const customer = await insertUser();
        const { accessToken } = await signIn(customer.email);
        const { sub, sid } = claimsOf(accessToken) as {
          sub: string;
          sid: string;
        };
        return { sub, sid };
      }

      const unsigned = (claims: object) =>
        [
          Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString(
            'base64url',
          ),
          Buffer.from(JSON.stringify(claims)).toString('base64url'),
          '',
        ].join('.');

      it.each([
        [
          'expired',
          (claims: object) =>
            jwt.sign(
              { ...claims, exp: Math.floor(Date.now() / 1000) - 10 },
              { secret: SECRET },
            ),
        ],
        [
          'signed with another key',
          (claims: object) => jwt.sign(claims, { secret: 'y'.repeat(40) }),
        ],
        [
          'signed with another algorithm',
          (claims: object) =>
            jwt.sign(claims, { secret: SECRET, algorithm: 'HS512' }),
        ],
        ['unsigned (alg none)', unsigned],
        [
          'without a session',
          ({ sub }: { sub: string }) => jwt.sign({ sub }, { secret: SECRET }),
        ],
        [
          'of an unknown session',
          ({ sub }: { sub: string }) =>
            jwt.sign({ sub, sid: newId() }, { secret: SECRET }),
        ],
      ])('%s', async (_, forge) => {
        const token = forge(await validClaims());

        const response = await me(token).expect(401);

        expect(response.body.type).toBe('/problems/unauthenticated');
      });

      it('with a tampered payload', async () => {
        const customer = await insertUser();
        const other = await insertUser();
        const { accessToken } = await signIn(customer.email);
        const [header, payload, signature] = accessToken.split('.');
        const tampered = Buffer.from(
          JSON.stringify({ ...claimsOf(accessToken), sub: other.id }),
        ).toString('base64url');

        await me([header, tampered, signature].join('.')).expect(401);
        expect(payload).not.toBe(tampered);
      });

      it('in another scheme, while public routes ignore it', async () => {
        await http()
          .get('/v1/me')
          .set('Authorization', 'Basic YW5hOnNlY3JldA==')
          .expect(401);
        await http()
          .get('/v1/geo/states')
          .set(bearer('not-a-token'))
          .expect(200);
      });
    });

    it('is checked before rate limiting, so limits per user count each user apart (ADR-0102)', async () => {
      const first = await signIn((await insertUser()).email);
      const second = await signIn((await insertUser()).email);
      const place = (token: string) =>
        http().post('/v1/test-auth/orders').set(bearer(token)).send({});

      await place(first.accessToken).expect(201);
      await place(first.accessToken).expect(201);
      await place(first.accessToken).expect(429);

      await place(second.accessToken).expect(201);
    });
  });
});
