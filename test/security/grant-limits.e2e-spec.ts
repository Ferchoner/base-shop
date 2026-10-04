import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../../src/app.module.js';
import { PasswordHasher } from '../../src/modules/identity-access/application/password-hasher.js';
import { configureHttp } from '../../src/platform/http/configure-http.js';
import { PrismaService } from '../../src/platform/persistence/prisma.service.js';
import { newId } from '../../src/shared-kernel/index.js';

const PASSWORD = 'una frase larga y segura';
/** Superadmin role of the migration `20260928120000_identity_initial_roles` (ADR-0043). */
const SUPERADMIN = '01a0ea00-c750-7792-a69b-a7289f1a8f47';

/**
 * Nobody gives what they do not hold (T-310, SA-03, BR-USR-20, ADR-0154): a staff member with `staff.manage` only
 * grants roles and permissions they hold, and never the superadmin role nor the temporary password of someone holding
 * more. Signing in for real, since the limits read the actor's roles from the database.
 */
describe('Grant limits (e2e, T-310)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let passwordHash: string;
  const roles: string[] = [];
  /** A role to manage staff that can also read orders, and nothing else. */
  let managerRole: string;
  /** A role the manager holds, and one with a permission the manager lacks. */
  let held: string;
  let notHeld: string;
  let manager: string;
  let superadmin: string;

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
    managerRole = await insertRole(['staff.manage', 'orders.read']);
    held = await insertRole(['orders.read']);
    notHeld = await insertRole(['orders.read', 'customers.read']);
    manager = await signIn(await insertStaff([managerRole]));
    superadmin = await signIn(await insertStaff([SUPERADMIN]));
  });

  afterEach(async () => {
    await prisma.refreshToken.deleteMany();
    await prisma.userRole.deleteMany();
    await prisma.user.deleteMany();
    await prisma.role.deleteMany({ where: { id: { in: roles } } });
    roles.length = 0;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: {
        action: {
          in: [
            'auth.login',
            'staff.create',
            'staff.roles-replace',
            'staff.reactivate',
            'roles.create',
            'roles.update',
            'http.access-denied',
          ],
        },
      },
    });
    await app.close();
  });

  async function insertRole(permissions: string[]): Promise<string> {
    const id = newId();
    await prisma.role.create({
      data: {
        id,
        name: `Rol ${id}`,
        permissions: {
          create: permissions.map((permissionCode) => ({ permissionCode })),
        },
      },
    });
    roles.push(id);
    return id;
  }

  async function insertStaff(
    roleIds: string[],
    status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE',
  ): Promise<string> {
    const id = newId();
    await prisma.user.create({
      data: {
        id,
        type: 'STAFF',
        status,
        suspendedAt: status === 'SUSPENDED' ? new Date() : null,
        email: `${id}@example.com`,
        firstNames: 'Ana',
        lastNames: 'Pérez',
        passwordHash,
        roles: { create: roleIds.map((roleId) => ({ roleId })) },
      },
    });
    return id;
  }

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  async function signIn(userId: string): Promise<string> {
    const response = await http()
      .post('/v1/auth/login')
      .send({ email: `${userId}@example.com`, password: PASSWORD })
      .expect(200);
    return response.body.accessToken;
  }
  const createStaff = (token: string, roleIds: string[]) =>
    http()
      .post('/v1/admin/identity/staff')
      .set(bearer(token))
      .send({
        email: `${newId()}@example.com`,
        firstNames: 'Luis',
        lastNames: 'García',
        roleIds,
      });
  const replaceRoles = (token: string, userId: string, roleIds: string[]) =>
    http()
      .put(`/v1/admin/identity/staff/${userId}/roles`)
      .set(bearer(token))
      .send({ roleIds, version: 1 });
  const createRole = (token: string, permissions: string[]) =>
    http()
      .post('/v1/admin/identity/roles')
      .set(bearer(token))
      .send({ name: `Rol ${newId()}`, permissions });
  const updateRole = (token: string, roleId: string, permissions: string[]) =>
    http()
      .patch(`/v1/admin/identity/roles/${roleId}`)
      .set(bearer(token))
      .send({ permissions, version: 1 });
  const reactivate = (token: string, userId: string) =>
    http()
      .post(`/v1/admin/identity/staff/${userId}/reactivate`)
      .set(bearer(token))
      .send({ reason: 'Revisión terminada', version: 1 });

  function expectForbidden(response: request.Response): void {
    expect(response.status).toBe(403);
    expect(response.body.type).toBe('/problems/forbidden');
  }

  async function forget(response: request.Response): Promise<void> {
    if (response.status === 201) roles.push(response.body.id);
  }

  it('creates staff only with roles the actor holds, and the superadmin role only by a superadmin', async () => {
    await createStaff(manager, [held]).expect(201);
    await createStaff(manager, [held, managerRole]).expect(201);

    expectForbidden(await createStaff(manager, [held, notHeld]));
    expectForbidden(await createStaff(manager, [SUPERADMIN]));
    await createStaff(superadmin, [SUPERADMIN, notHeld]).expect(201);
    expect(await prisma.user.count({ where: { type: 'STAFF' } })).toBe(5);
  });

  it('adds only roles the actor holds, and lets them keep or remove any other', async () => {
    const staff = await insertStaff([held, notHeld]);
    const other = await insertStaff([held]);

    expectForbidden(await replaceRoles(manager, other, [held, notHeld]));
    expectForbidden(await replaceRoles(manager, other, [held, SUPERADMIN]));
    await replaceRoles(manager, staff, [notHeld]).expect(200);
    await replaceRoles(superadmin, other, [held, SUPERADMIN]).expect(200);
  });

  it('creates and edits roles only with permissions the actor holds, and lets them remove any', async () => {
    const created = await createRole(manager, ['orders.read']).expect(201);
    await forget(created);

    const wider = await createRole(manager, ['orders.read', 'customers.read']);
    await forget(wider);
    expectForbidden(wider);
    expectForbidden(
      await updateRole(manager, held, ['orders.read', 'customers.read']),
    );
    // Removing gives nothing, even from a role with a permission the actor lacks.
    await updateRole(manager, notHeld, ['customers.read']).expect(200);
    const permissionsOf = async (roleId: string) =>
      (await prisma.rolePermission.findMany({ where: { roleId } })).map(
        (permission) => permission.permissionCode,
      );
    expect(await permissionsOf(held)).toEqual(['orders.read']);
    expect(await permissionsOf(notHeld)).toEqual(['customers.read']);
  });

  it('never gives the temporary password of a staff member holding more than the actor', async () => {
    const above = await insertStaff([notHeld], 'SUSPENDED');
    const fallen = await insertStaff([SUPERADMIN], 'SUSPENDED');
    const below = await insertStaff([held], 'SUSPENDED');

    expectForbidden(await reactivate(manager, above));
    expectForbidden(await reactivate(manager, fallen));
    const allowed = await reactivate(manager, below).expect(200);

    expect(allowed.body.temporaryPassword).toEqual(expect.any(String));
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: above } })).status,
    ).toBe('SUSPENDED');
    await reactivate(superadmin, fallen).expect(200);
  });

  it('audits a refused grant as a denied access, without changing anything', async () => {
    const before = await prisma.user.count();

    expectForbidden(await createStaff(manager, [SUPERADMIN]));

    expect(await prisma.user.count()).toBe(before);
    expect(
      await prisma.auditLog.findFirst({
        where: {
          action: 'http.access-denied',
          resourceId: 'POST /v1/admin/identity/staff',
        },
      }),
    ).toMatchObject({ result: 'DENIED' });
  });
});
