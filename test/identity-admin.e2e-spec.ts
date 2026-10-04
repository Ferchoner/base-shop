import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import type { AuthenticatedUser } from '../src/platform/auth/authenticated-user.js';
import { configureHttp } from '../src/platform/http/configure-http.js';
import { PrismaService } from '../src/platform/persistence/prisma.service.js';
import { newId, PERMISSION_CODES } from '../src/shared-kernel/index.js';
import {
  signedInAs,
  useTestAuthentication,
} from './support/test-authentication.js';

/** Roles created by the migration `20260928120000_identity_initial_roles` (ADR-0043). */
const SUPERADMIN = '01a0ea00-c750-7792-a69b-a7289f1a8f47';
const ADMINISTRATOR = '01a0ea00-c755-706d-9721-7e4a48b61d77';
const OPERATOR = '01a0ea00-c755-706d-9721-83f80a3d8630';

/** Administration of roles, staff and customers over HTTP (T-130 part b, API_SPEC.md §9.15 to §9.18). */
describe('Identity & Access administration (e2e, T-130)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let superadmin: AuthenticatedUser;
  const createdRoles: string[] = [];

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication<INestApplication<App>>();
    useTestAuthentication(app);
    configureHttp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    superadmin = {
      id: await insertUser('STAFF', { roleIds: [SUPERADMIN] }),
      type: 'STAFF',
      permissions: [...PERMISSION_CODES],
      mustChangePassword: false,
      sessionId: newId(),
    };
  });

  afterEach(async () => {
    await prisma.userRole.deleteMany();
    await prisma.user.deleteMany();
    await prisma.role.deleteMany({ where: { id: { in: createdRoles } } });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: {
        action: {
          in: [
            'roles.create',
            'roles.update',
            'roles.delete',
            'staff.roles-replace',
            'staff.suspend',
            'customers.suspend',
            'customers.reactivate',
            'http.access-denied',
          ],
        },
      },
    });
    await app.close();
  });

  async function insertUser(
    type: 'CUSTOMER' | 'STAFF',
    options: { roleIds?: string[]; status?: 'ACTIVE' | 'SUSPENDED' } = {},
  ): Promise<string> {
    const id = newId();
    await prisma.user.create({
      data: {
        id,
        type,
        status: options.status ?? 'ACTIVE',
        email: `${id}@example.com`,
        firstNames: 'Ana',
        lastNames: 'Pérez',
        // Not a real hash: these tests never sign in.
        passwordHash: 'not-a-real-hash',
        roles: {
          create: (options.roleIds ?? []).map((roleId) => ({ roleId })),
        },
      },
    });
    return id;
  }

  function staffWith(...permissions: AuthenticatedUser['permissions']) {
    return signedInAs({
      id: newId(),
      type: 'STAFF',
      permissions,
      mustChangePassword: false,
      sessionId: newId(),
    });
  }

  const http = () => request(app.getHttpServer());
  const asSuperadmin = () => signedInAs(superadmin);

  describe('permissions and roles (UC-IAM-15)', () => {
    it('lists the permission catalog, only for staff.manage', async () => {
      const response = await http()
        .get('/v1/admin/identity/permissions')
        .set(asSuperadmin())
        .expect(200)
        .expect('Cache-Control', 'no-store');

      expect(response.body.data).toHaveLength(17);
      expect(response.body.data[0]).toEqual({
        code: 'catalog.read',
        description:
          'Ver el catálogo administrativo, incluidos borradores y archivados',
      });
      // The last one, of the platform (ADR-0150).
      expect(response.body.data[16]).toEqual({
        code: 'events.manage',
        description: 'Ver y reintentar las entregas de eventos de dominio',
      });
      // For the blocked data of an order (ADR-0152).
      expect(response.body.data).toContainEqual({
        code: 'orders.read-blocked',
        description:
          'Consultar los datos personales bloqueados de un pedido, con motivo y auditado',
      });
      await http()
        .get('/v1/admin/identity/permissions')
        .set(staffWith('customers.manage'))
        .expect(403);
    });

    it('creates a role, with its Location, and rejects a repeated name', async () => {
      const body = {
        name: 'Soporte',
        description: 'Atiende a clientes',
        permissions: ['customers.read', 'orders.read'],
      };

      const created = await http()
        .post('/v1/admin/identity/roles')
        .set(asSuperadmin())
        .send(body)
        .expect(201);
      createdRoles.push(created.body.id);

      expect(created.headers.location).toBe(
        `/v1/admin/identity/roles/${created.body.id}`,
      );
      expect(created.body).toMatchObject({
        name: 'Soporte',
        isSuperadmin: false,
        permissions: ['customers.read', 'orders.read'],
        userCount: 0,
        version: 1,
      });
      const duplicate = await http()
        .post('/v1/admin/identity/roles')
        .set(asSuperadmin())
        .send(body)
        .expect(409);
      expect(duplicate.body).toMatchObject({
        type: '/problems/duplicate-value',
        field: 'name',
      });
    });

    it('rejects permissions outside the catalog (BR-USR-04)', async () => {
      const response = await http()
        .post('/v1/admin/identity/roles')
        .set(asSuperadmin())
        .send({ name: 'Soporte', permissions: ['orders.delete'] })
        .expect(400);

      expect(response.body.errors[0].field).toMatch(/^permissions/);
    });

    it('lists roles by name, in pages', async () => {
      const response = await http()
        .get('/v1/admin/identity/roles?sort=-name&pageSize=2')
        .set(asSuperadmin())
        .expect(200);

      expect(response.body.data.map((r: { name: string }) => r.name)).toEqual([
        'Superadministrador',
        'Operador',
      ]);
      expect(response.body.meta).toMatchObject({ page: 1, pageSize: 2 });
    });

    it('updates a role with its version and answers an outdated one', async () => {
      const { body: role } = await http()
        .post('/v1/admin/identity/roles')
        .set(asSuperadmin())
        .send({ name: 'Soporte', permissions: [] })
        .expect(201);
      createdRoles.push(role.id);

      await http()
        .patch(`/v1/admin/identity/roles/${role.id}`)
        .set(asSuperadmin())
        .send({ name: 'Atención', permissions: ['orders.read'], version: 1 })
        .expect(200)
        .expect((res) =>
          expect(res.body).toMatchObject({ name: 'Atención', version: 2 }),
        );
      const conflict = await http()
        .patch(`/v1/admin/identity/roles/${role.id}`)
        .set(asSuperadmin())
        .send({ name: 'Otro', version: 1 })
        .expect(409);
      expect(conflict.body).toMatchObject({
        type: '/problems/version-conflict',
        currentVersion: 2,
      });
    });

    it('answers 400 on the permissions of the superadmin role', async () => {
      const { body: role } = await http()
        .get(`/v1/admin/identity/roles/${SUPERADMIN}`)
        .set(asSuperadmin())
        .expect(200);

      const response = await http()
        .patch(`/v1/admin/identity/roles/${SUPERADMIN}`)
        .set(asSuperadmin())
        .send({ permissions: ['orders.read'], version: role.version })
        .expect(400);

      expect(response.body).toMatchObject({
        type: '/problems/validation-error',
        errors: [
          {
            field: 'permissions',
            message:
              'El rol superadministrador siempre tiene todos los permisos.',
          },
        ],
      });
    });

    it('deletes an unused role, never the superadmin role or one with users', async () => {
      const { body: role } = await http()
        .post('/v1/admin/identity/roles')
        .set(asSuperadmin())
        .send({ name: 'Temporal', permissions: [] })
        .expect(201);
      createdRoles.push(role.id);
      await insertUser('STAFF', { roleIds: [OPERATOR] });

      await http()
        .delete(`/v1/admin/identity/roles/${role.id}`)
        .set(asSuperadmin())
        .expect(204);
      await http()
        .delete(`/v1/admin/identity/roles/${SUPERADMIN}`)
        .set(asSuperadmin())
        .expect(409)
        .expect((res) =>
          expect(res.body.type).toBe('/problems/last-superadmin'),
        );
      await http()
        .delete(`/v1/admin/identity/roles/${OPERATOR}`)
        .set(asSuperadmin())
        .expect(409)
        .expect((res) =>
          expect(res.body.type).toBe('/problems/resource-in-use'),
        );
    });

    it.each(['not-a-uuid', newId()])(
      'answers 404 for the role %s',
      async (roleId) => {
        await http()
          .get(`/v1/admin/identity/roles/${roleId}`)
          .set(asSuperadmin())
          .expect(404);
      },
    );
  });

  describe('staff (UC-IAM-14, UC-IAM-16)', () => {
    it('lists staff by status and shows a staff member', async () => {
      const suspended = await insertUser('STAFF', {
        status: 'SUSPENDED',
        roleIds: [OPERATOR],
      });

      const list = await http()
        .get('/v1/admin/identity/staff?status=SUSPENDED')
        .set(asSuperadmin())
        .expect(200);
      expect(list.body.data.map((s: { id: string }) => s.id)).toEqual([
        suspended,
      ]);
      const detail = await http()
        .get(`/v1/admin/identity/staff/${suspended}`)
        .set(asSuperadmin())
        .expect(200);
      expect(detail.body).toMatchObject({
        status: 'SUSPENDED',
        roles: [{ id: OPERATOR, name: 'Operador' }],
      });
    });

    it('replaces the roles of a staff member', async () => {
      const staff = await insertUser('STAFF', { roleIds: [OPERATOR] });

      const response = await http()
        .put(`/v1/admin/identity/staff/${staff}/roles`)
        .set(asSuperadmin())
        .send({ roleIds: [ADMINISTRATOR], version: 1 })
        .expect(200);

      expect(response.body).toMatchObject({
        roles: [{ id: ADMINISTRATOR, name: 'Administrador' }],
        version: 2,
      });
    });

    it('answers 409 last-superadmin and 400 without roles', async () => {
      await http()
        .put(`/v1/admin/identity/staff/${superadmin.id}/roles`)
        .set(asSuperadmin())
        .send({ roleIds: [ADMINISTRATOR], version: 1 })
        .expect(409)
        .expect((res) =>
          expect(res.body.type).toBe('/problems/last-superadmin'),
        );
      await http()
        .put(`/v1/admin/identity/staff/${superadmin.id}/roles`)
        .set(asSuperadmin())
        .send({ roleIds: [], version: 1 })
        .expect(400);
    });

    it('suspends a staff member with a reason, kept in the audit trail', async () => {
      const staff = await insertUser('STAFF', { roleIds: [OPERATOR] });

      await http()
        .post(`/v1/admin/identity/staff/${staff}/suspend`)
        .set(asSuperadmin())
        .send({ reason: 'Salida del equipo', version: 1 })
        .expect(200)
        .expect((res) => expect(res.body.status).toBe('SUSPENDED'));

      expect(
        await prisma.auditLog.findFirst({
          where: { action: 'staff.suspend', resourceId: staff },
        }),
      ).toMatchObject({
        actorType: 'USER',
        actorId: superadmin.id,
        reason: 'Salida del equipo',
      });
    });

    it('never lets staff suspend themselves, and requires a reason', async () => {
      await insertUser('STAFF', { roleIds: [SUPERADMIN] });

      const self = await http()
        .post(`/v1/admin/identity/staff/${superadmin.id}/suspend`)
        .set(asSuperadmin())
        .send({ reason: 'Prueba', version: 1 })
        .expect(409);
      expect(self.body).toMatchObject({
        type: '/problems/invalid-state-transition',
        currentStatus: 'ACTIVE',
      });
      const blank = await http()
        .post(`/v1/admin/identity/staff/${superadmin.id}/suspend`)
        .set(asSuperadmin())
        .send({ reason: '   ', version: 1 })
        .expect(400);
      expect(blank.body.errors).toEqual([
        expect.objectContaining({
          field: 'reason',
          message: 'No puede estar vacío.',
        }),
      ]);
    });
  });

  describe('customers (UC-IAM-17, UC-IAM-18)', () => {
    it('lists and shows customers with customers.read', async () => {
      const customer = await insertUser('CUSTOMER');

      const list = await http()
        .get('/v1/admin/identity/customers?status=ACTIVE&emailVerified=false')
        .set(staffWith('customers.read'))
        .expect(200);
      expect(list.body.data.map((c: { id: string }) => c.id)).toEqual([
        customer,
      ]);
      await http()
        .get(`/v1/admin/identity/customers/${customer}`)
        .set(staffWith('customers.read'))
        .expect(200)
        .expect((res) => {
          expect(res.body).toMatchObject({ addresses: [] });
          // Its orders are in GET /v1/admin/orders?customerId=… (ADR-0133).
          expect(res.body).not.toHaveProperty('orderCount');
        });
    });

    it('answers a staff member as a missing customer', async () => {
      await http()
        .get(`/v1/admin/identity/customers/${superadmin.id}`)
        .set(staffWith('customers.read'))
        .expect(404);
    });

    it('suspends and reactivates a customer with customers.manage', async () => {
      const customer = await insertUser('CUSTOMER');

      await http()
        .post(`/v1/admin/identity/customers/${customer}/suspend`)
        .set(staffWith('customers.read'))
        .send({ reason: 'Reporte de fraude', version: 1 })
        .expect(403);
      await http()
        .post(`/v1/admin/identity/customers/${customer}/suspend`)
        .set(staffWith('customers.manage'))
        .send({ reason: 'Reporte de fraude', version: 1 })
        .expect(200)
        .expect((res) => expect(res.body.status).toBe('SUSPENDED'));
      await http()
        .post(`/v1/admin/identity/customers/${customer}/reactivate`)
        .set(staffWith('customers.manage'))
        .send({ reason: 'Aclarado', version: 2 })
        .expect(200)
        .expect((res) => expect(res.body.status).toBe('ACTIVE'));
    });

    it('answers 409 when reactivating an active customer', async () => {
      const customer = await insertUser('CUSTOMER');

      const response = await http()
        .post(`/v1/admin/identity/customers/${customer}/reactivate`)
        .set(staffWith('customers.manage'))
        .send({ reason: 'Aclarado', version: 1 })
        .expect(409);

      expect(response.body).toMatchObject({
        type: '/problems/invalid-state-transition',
        currentStatus: 'ACTIVE',
      });
    });

    it('rejects an undeclared sort and a malformed date', async () => {
      await http()
        .get('/v1/admin/identity/customers?sort=firstNames')
        .set(staffWith('customers.read'))
        .expect(400);
      await http()
        .get('/v1/admin/identity/customers?createdFrom=ayer')
        .set(staffWith('customers.read'))
        .expect(400);
    });
  });

  it('never caches authenticated responses, errors included (ADR-0071)', async () => {
    await http()
      .get('/v1/admin/identity/roles')
      .expect(401)
      .expect('Cache-Control', 'no-store');
  });
});
