import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { PasswordHasher } from '../src/modules/identity-access/application/password-hasher.js';
import { configureHttp } from '../src/platform/http/configure-http.js';
import { PrismaService } from '../src/platform/persistence/prisma.service.js';
import { newId } from '../src/shared-kernel/index.js';

const PASSWORD = 'una frase larga y segura';
const NEW_PASSWORD = 'otra frase larga y distinta';
const TEMPORARY_PASSWORD = /^[a-km-np-z2-9]{4}(-[a-km-np-z2-9]{4}){4}$/;
/** Roles of the migration `20260928120000_identity_initial_roles` (ADR-0043). */
const SUPERADMIN = '01a0ea00-c750-7792-a69b-a7289f1a8f47';
const OPERATOR = '01a0ea00-c755-706d-9721-83f80a3d8630';

/** Creating and reactivating staff over HTTP, signing in for real (T-131, API_SPEC.md §9.17, ADR-0116). */
describe('Staff accounts (e2e, T-131)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let passwordHash: string;
  let admin: string;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication<INestApplication<App>>();
    configureHttp(app);
    await app.init();
    prisma = app.get(PrismaService);
    passwordHash = await app.get(PasswordHasher).hash(PASSWORD);
  });

  beforeEach(async () => {
    admin = await signIn(await insertStaff([SUPERADMIN]));
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
            'auth.password-change',
            'staff.create',
            'staff.suspend',
            'staff.reactivate',
            'http.access-denied',
          ],
        },
      },
    });
    await app.close();
  });

  async function insertStaff(roleIds: string[]): Promise<string> {
    const id = newId();
    const email = `${id}@example.com`;
    await prisma.user.create({
      data: {
        id,
        type: 'STAFF',
        email,
        firstNames: 'Ana',
        lastNames: 'Pérez',
        passwordHash,
        roles: { create: roleIds.map((roleId) => ({ roleId })) },
      },
    });
    return email;
  }

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  async function signIn(email: string, password = PASSWORD): Promise<string> {
    const response = await http()
      .post('/v1/auth/login')
      .send({ email, password })
      .expect(200);
    return response.body.accessToken;
  }
  const createStaff = (body: object, token = admin) =>
    http().post('/v1/admin/identity/staff').set(bearer(token)).send(body);
  const NEW_STAFF = {
    email: 'Luis.Garcia@Example.com',
    firstNames: 'Luis',
    lastNames: 'García',
    roleIds: [OPERATOR],
  };

  describe('creating staff (UC-IAM-13)', () => {
    it('answers 201 with the account and its temporary password, never cached', async () => {
      const response = await createStaff(NEW_STAFF).expect(201);

      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers.location).toBe(
        `/v1/admin/identity/staff/${response.body.user.id}`,
      );
      expect(response.body).toEqual({
        user: {
          id: expect.any(String),
          email: 'luis.garcia@example.com',
          firstNames: 'Luis',
          lastNames: 'García',
          status: 'ACTIVE',
          mustChangePassword: true,
          roles: [{ id: OPERATOR, name: 'Operador' }],
          lastLoginAt: null,
          version: 1,
          createdAt: expect.any(String),
        },
        temporaryPassword: expect.stringMatching(TEMPORARY_PASSWORD),
      });
    });

    it('lets the new staff member in only to change the temporary password, and then to work', async () => {
      const { temporaryPassword } = (await createStaff(NEW_STAFF).expect(201))
        .body;
      const token = await signIn('luis.garcia@example.com', temporaryPassword);

      await http()
        .get('/v1/admin/identity/customers')
        .set(bearer(token))
        .expect(403);
      await http()
        .post('/v1/me/password')
        .set(bearer(token))
        .send({ currentPassword: temporaryPassword, newPassword: NEW_PASSWORD })
        .expect(204);
      await http()
        .get('/v1/admin/identity/customers')
        .set(bearer(token))
        .expect(200);
    });

    it('rejects a taken email with 409', async () => {
      await createStaff(NEW_STAFF).expect(201);

      const response = await createStaff({
        ...NEW_STAFF,
        email: 'luis.garcia@example.com',
      }).expect(409);

      expect(response.body).toMatchObject({
        type: '/problems/duplicate-value',
        field: 'email',
      });
    });

    it.each([
      [{ ...NEW_STAFF, roleIds: [] }, 'roleIds', 'arrayMinSize'],
      [{ ...NEW_STAFF, roleIds: [newId()] }, 'roleIds', 'unknownRoles'],
      [{ ...NEW_STAFF, email: 'no-es-un-correo' }, 'email', 'isEmail'],
      [{ ...NEW_STAFF, firstNames: '   ' }, 'firstNames', 'matches'],
      [
        { ...NEW_STAFF, password: 'una frase larga y segura' },
        'password',
        'whitelistValidation',
      ],
    ])('rejects an invalid request %#', async (body, field, code) => {
      const response = await createStaff(body).expect(400);

      expect(response.body.errors).toContainEqual(
        expect.objectContaining({ field, code }),
      );
    });

    it('is only for staff.manage', async () => {
      const operator = await signIn(await insertStaff([OPERATOR]));

      await createStaff(NEW_STAFF, operator).expect(403);
    });
  });

  describe('reactivating staff (UC-IAM-16)', () => {
    it('gives a new temporary password: the old password stops working and the roles stay', async () => {
      const email = await insertStaff([OPERATOR]);
      const { id } = await prisma.user.findUniqueOrThrow({ where: { email } });
      const suspended = await http()
        .post(`/v1/admin/identity/staff/${id}/suspend`)
        .set(bearer(admin))
        .send({ reason: 'Acceso sospechoso', version: 1 })
        .expect(200);

      const response = await http()
        .post(`/v1/admin/identity/staff/${id}/reactivate`)
        .set(bearer(admin))
        .send({ reason: 'Revisión terminada', version: suspended.body.version })
        .expect(200);

      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).toMatchObject({
        user: {
          id,
          status: 'ACTIVE',
          mustChangePassword: true,
          roles: [{ id: OPERATOR, name: 'Operador' }],
        },
        temporaryPassword: expect.stringMatching(TEMPORARY_PASSWORD),
      });
      await http()
        .post('/v1/auth/login')
        .send({ email, password: PASSWORD })
        .expect(401);
      await signIn(email, response.body.temporaryPassword);
    });

    it('rejects reactivating an active staff member', async () => {
      const email = await insertStaff([OPERATOR]);
      const { id } = await prisma.user.findUniqueOrThrow({ where: { email } });

      const response = await http()
        .post(`/v1/admin/identity/staff/${id}/reactivate`)
        .set(bearer(admin))
        .send({ reason: 'Prueba', version: 1 })
        .expect(409);

      expect(response.body).toMatchObject({
        type: '/problems/invalid-state-transition',
        currentStatus: 'ACTIVE',
      });
    });
  });
});
