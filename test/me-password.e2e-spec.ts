import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { PasswordHasher } from '../src/modules/identity-access/application/password-hasher.js';
import { configureHttp } from '../src/platform/http/configure-http.js';
import { PrismaService } from '../src/platform/persistence/prisma.service.js';
import {
  type EmailMessage,
  EmailSender,
  newId,
} from '../src/shared-kernel/index.js';

const PASSWORD = 'una frase larga y segura';
const NEW_PASSWORD = 'otra frase larga y distinta';
/** Operator role of the migration `20260928120000_identity_initial_roles` (ADR-0043). */
const OPERATOR = '01a0ea00-c755-706d-9721-83f80a3d8630';

/** Keeps the emails instead of sending them. */
class RecordingEmailSender extends EmailSender {
  readonly sent: EmailMessage[] = [];

  send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }
}

/** Changing my password over HTTP (T-120 part b, UC-IAM-09, API_SPEC.md §9.12, ADR-0115). */
describe('My password (e2e, T-120)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let passwordHash: string;
  const email = new RecordingEmailSender();

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(EmailSender)
      .useValue(email)
      .compile();
    app = moduleFixture.createNestApplication<INestApplication<App>>();
    configureHttp(app);
    await app.init();
    prisma = app.get(PrismaService);
    passwordHash = await app.get(PasswordHasher).hash(PASSWORD);
  });

  afterEach(async () => {
    email.sent.length = 0;
    await prisma.refreshToken.deleteMany();
    await prisma.userRole.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: {
        action: {
          in: ['auth.login', 'auth.password-change', 'http.access-denied'],
        },
      },
    });
    await app.close();
  });

  async function insertUser(
    type: 'CUSTOMER' | 'STAFF' = 'CUSTOMER',
    mustChangePassword = false,
  ): Promise<string> {
    const id = newId();
    const address = `${id}@example.com`;
    await prisma.user.create({
      data: {
        id,
        type,
        email: address,
        firstNames: 'Ana',
        lastNames: 'Pérez',
        passwordHash,
        mustChangePassword,
        roles: { create: type === 'STAFF' ? [{ roleId: OPERATOR }] : [] },
      },
    });
    return address;
  }

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const login = (address: string, password = PASSWORD) =>
    http().post('/v1/auth/login').send({ email: address, password });
  const signIn = async (address: string): Promise<string> =>
    (await login(address).expect(200)).body.accessToken;
  const changePassword = (token: string, body: object) =>
    http().post('/v1/me/password').set(bearer(token)).send(body);

  it('changes the password: this session goes on, the others end, and the owner is told', async () => {
    const address = await insertUser();
    const current = await signIn(address);
    const other = await signIn(address);

    const response = await changePassword(current, {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    }).expect(204);

    expect(response.headers['cache-control']).toBe('no-store');
    await http().get('/v1/me').set(bearer(current)).expect(200);
    await http().get('/v1/me').set(bearer(other)).expect(401);
    await login(address, NEW_PASSWORD).expect(200);
    await login(address).expect(401);
    expect(email.sent).toEqual([
      expect.objectContaining({ to: address, subject: 'Tu contraseña cambió' }),
    ]);
  });

  it('lets staff with a temporary password change it, and then use their permissions with the same token', async () => {
    const address = await insertUser('STAFF', true);
    const token = await signIn(address);
    const customers = () =>
      http().get('/v1/admin/identity/customers').set(bearer(token));
    await customers().expect(403);

    await changePassword(token, {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    }).expect(204);

    await customers().expect(200);
    const account = await http().get('/v1/me').set(bearer(token)).expect(200);
    expect(account.body.mustChangePassword).toBe(false);
  });

  it('answers a wrong current password as invalid credentials', async () => {
    const token = await signIn(await insertUser());

    const response = await changePassword(token, {
      currentPassword: `${PASSWORD}!`,
      newPassword: NEW_PASSWORD,
    }).expect(401);

    expect(response.body.type).toBe('/problems/invalid-credentials');
  });

  it.each([
    [
      'too short',
      'corta',
      'passwordLength',
      'Debe tener entre 15 y 64 caracteres.',
    ],
    [
      'common',
      '1Q2W3E4R5T6Y7U8I',
      'commonPassword',
      'Es una contraseña común; elige otra.',
    ],
    [
      'the current one',
      PASSWORD,
      'samePassword',
      'Debe ser distinta de la contraseña actual.',
    ],
    [
      'with a tab',
      'otra frase\tlarga y distinta',
      'passwordCharacters',
      'Solo puede tener letras, dígitos, espacios y signos o símbolos imprimibles.',
    ],
  ])(
    'rejects a new password %s, naming the rule',
    async (_, newPassword, code, message) => {
      const token = await signIn(await insertUser());

      const response = await changePassword(token, {
        currentPassword: PASSWORD,
        newPassword,
      }).expect(400);

      expect(response.body).toMatchObject({
        type: '/problems/password-policy-violation',
        title: 'Contraseña no permitida',
        errors: [{ field: 'newPassword', code, message }],
      });
    },
  );

  it('rejects a malformed request, and one without a token', async () => {
    const token = await signIn(await insertUser());

    const malformed = await changePassword(token, {
      currentPassword: PASSWORD,
    }).expect(400);
    expect(malformed.body.type).toBe('/problems/validation-error');
    await http()
      .post('/v1/me/password')
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
      .expect(401);
  });
});
