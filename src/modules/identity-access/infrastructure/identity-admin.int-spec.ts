import { setTimeout as sleep } from 'node:timers/promises';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import pg from 'pg';
import { AppCacheModule } from '../../../platform/cache/app-cache.module.js';
import { ClockModule } from '../../../platform/clock/clock.module.js';
import { validateEnvironment } from '../../../platform/config/environment.js';
import { PersistenceModule } from '../../../platform/persistence/persistence.module.js';
import { PrismaService } from '../../../platform/persistence/prisma.service.js';
import {
  DuplicateValueError,
  InvalidStateTransitionError,
  newId,
  NotFoundError,
  PERMISSION_CODES,
  ResourceInUseError,
  VersionConflictError,
} from '../../../shared-kernel/index.js';
import { AuditModule } from '../../audit/index.js';
import { CreateRole } from '../application/create-role.use-case.js';
import { DeleteRole } from '../application/delete-role.use-case.js';
import { IdentityQueries } from '../application/identity.queries.js';
import { ReactivateCustomer } from '../application/reactivate-customer.use-case.js';
import { ReplaceStaffRoles } from '../application/replace-staff-roles.use-case.js';
import { SuspendCustomer } from '../application/suspend-customer.use-case.js';
import { SuspendStaff } from '../application/suspend-staff.use-case.js';
import { UpdateRole } from '../application/update-role.use-case.js';
import {
  LastSuperadminError,
  SuperadminPermissionsFixedError,
  UnknownRolesError,
} from '../domain/identity-errors.js';
import type { RoleId } from '../domain/role.js';
import type { UserId, UserStatus, UserType } from '../domain/user.js';
import { IdentityAccessModule } from '../identity-access.module.js';

/** Roles created by the migration `20260928120000_identity_initial_roles` (ADR-0043). */
const SUPERADMIN = '01a0ea00-c750-7792-a69b-a7289f1a8f47' as RoleId;
const ADMINISTRATOR = '01a0ea00-c755-706d-9721-7e4a48b61d77' as RoleId;
const OPERATOR = '01a0ea00-c755-706d-9721-83f80a3d8630' as RoleId;
const AUDITED_ACTIONS = [
  'roles.create',
  'roles.update',
  'roles.delete',
  'staff.roles-replace',
  'staff.suspend',
  'customers.suspend',
  'customers.reactivate',
];

/** Administration of roles, staff and customers against PostgreSQL 18 (T-130 part b, ADR-0112). */
describe('Identity & Access administration (T-130)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cls: ClsService;
  let queries: IdentityQueries;
  const createdRoles: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          validate: validateEnvironment,
        }),
        ClsModule.forRoot({ global: true }),
        PersistenceModule,
        ClockModule,
        AppCacheModule,
        AuditModule,
        IdentityAccessModule,
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    cls = moduleRef.get(ClsService);
    queries = moduleRef.get(IdentityQueries);
    await prisma.geoState.upsert({
      where: { code: '16' },
      create: { code: '16', name: 'Michoacán de Ocampo' },
      update: {},
    });
    await prisma.geoMunicipality.upsert({
      where: { code: '16053' },
      create: {
        code: '16053',
        stateCode: '16',
        name: 'Morelia',
        isActive: true,
      },
      update: {},
    });
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  afterEach(async () => {
    await prisma.customerAddress.deleteMany();
    await prisma.userRole.deleteMany();
    await prisma.user.deleteMany();
    await prisma.role.deleteMany({ where: { id: { in: createdRoles } } });
    await prisma.auditLog.deleteMany({
      where: { action: { in: AUDITED_ACTIONS } },
    });
  });

  /** Runs a use case in its own async context, as a request does. */
  function run<T>(work: () => Promise<T>): Promise<T> {
    return cls.run(work);
  }

  async function insertUser(
    type: UserType,
    options: {
      status?: UserStatus;
      roleIds?: RoleId[];
      email?: string;
      firstNames?: string;
      emailVerified?: boolean;
      createdAt?: Date;
      lastLoginAt?: Date;
    } = {},
  ): Promise<UserId> {
    const id = newId<'User'>();
    const anonymized = options.status === 'ANONYMIZED';
    await prisma.user.create({
      data: {
        id,
        type,
        status: options.status ?? 'ACTIVE',
        email: anonymized ? null : (options.email ?? `${id}@example.com`),
        firstNames: anonymized ? null : (options.firstNames ?? 'Ana'),
        lastNames: anonymized ? null : 'Pérez',
        // Not a real hash: these tests never sign in.
        passwordHash: anonymized ? null : 'not-a-real-hash',
        emailVerifiedAt: options.emailVerified ? new Date() : null,
        createdAt: options.createdAt,
        lastLoginAt: options.lastLoginAt,
        anonymizedAt: anonymized ? new Date() : null,
        roles: {
          create: (options.roleIds ?? []).map((roleId) => ({ roleId })),
        },
      },
    });
    return id;
  }

  const auditEntry = (action: string) =>
    prisma.auditLog.findFirst({ where: { action } });

  describe('roles (UC-IAM-15)', () => {
    async function createRole(name: string): Promise<RoleId> {
      const id = await run(() =>
        moduleRef.get(CreateRole).execute({
          name,
          description: null,
          permissions: ['orders.read', 'customers.read'],
        }),
      );
      createdRoles.push(id);
      return id;
    }

    it('creates a role and audits its fields', async () => {
      const id = await createRole('Soporte');

      expect(await queries.findRole(id)).toMatchObject({
        name: 'Soporte',
        isSuperadmin: false,
        permissions: ['customers.read', 'orders.read'],
        userCount: 0,
        version: 1,
      });
      expect((await auditEntry('roles.create'))?.changes).toEqual({
        name: { from: null, to: 'Soporte' },
        permissions: { from: null, to: ['customers.read', 'orders.read'] },
      });
    });

    it('rejects a repeated name', async () => {
      await createRole('Soporte');

      await expect(createRole('Soporte')).rejects.toThrow(
        new DuplicateValueError('name'),
      );
    });

    it('updates a role with the version it was read at', async () => {
      const id = await createRole('Soporte');

      await run(() =>
        moduleRef.get(UpdateRole).execute(id, {
          name: 'Atención',
          permissions: ['orders.read'],
          version: 1,
        }),
      );

      expect(await queries.findRole(id)).toMatchObject({
        name: 'Atención',
        permissions: ['orders.read'],
        version: 2,
      });
      await expect(
        run(() =>
          moduleRef.get(UpdateRole).execute(id, { name: 'Otro', version: 1 }),
        ),
      ).rejects.toThrow(new VersionConflictError(2));
    });

    it('renames the superadmin role, but never changes its permissions', async () => {
      const update = moduleRef.get(UpdateRole);
      const { version } = (await queries.findRole(SUPERADMIN))!;

      await expect(
        run(() =>
          update.execute(SUPERADMIN, { permissions: ['orders.read'], version }),
        ),
      ).rejects.toThrow(SuperadminPermissionsFixedError);
      await run(() =>
        update.execute(SUPERADMIN, { name: 'Superadmin', version }),
      );
      await run(() =>
        update.execute(SUPERADMIN, {
          name: 'Superadministrador',
          version: version + 1,
        }),
      );

      expect((await queries.findRole(SUPERADMIN))?.permissions).toEqual(
        PERMISSION_CODES,
      );
    });

    it('never deletes the superadmin role or a role with users', async () => {
      await insertUser('STAFF', { roleIds: [OPERATOR] });
      const remove = moduleRef.get(DeleteRole);

      await expect(run(() => remove.execute(SUPERADMIN))).rejects.toThrow(
        LastSuperadminError,
      );
      await expect(run(() => remove.execute(OPERATOR))).rejects.toThrow(
        ResourceInUseError,
      );
    });

    it('deletes an unused role with its permissions', async () => {
      const id = await createRole('Temporal');

      await run(() => moduleRef.get(DeleteRole).execute(id));

      expect(await queries.findRole(id)).toBeNull();
      expect(await prisma.rolePermission.count({ where: { roleId: id } })).toBe(
        0,
      );
      expect(await auditEntry('roles.delete')).toMatchObject({
        resourceId: id,
      });
    });

    it('lists roles by name with their user count, filtered by name', async () => {
      await insertUser('STAFF', { roleIds: [OPERATOR] });
      await insertUser('STAFF', { roleIds: [OPERATOR, ADMINISTRATOR] });

      const page = await queries.listRoles(
        { q: 'ADMIN' },
        [{ field: 'name', direction: 'desc' }],
        { page: 1, pageSize: 20 },
      );

      expect(page.totalItems).toBe(2);
      expect(page.items.map((role) => [role.name, role.userCount])).toEqual([
        ['Superadministrador', 0],
        ['Administrador', 1],
      ]);
    });
  });

  describe('staff roles (UC-IAM-14, BR-USR-03)', () => {
    const replace = (actorId: UserId, userId: UserId, roleIds: RoleId[]) =>
      run(() =>
        moduleRef
          .get(ReplaceStaffRoles)
          .execute({ actorId, userId, roleIds, version: 1 }),
      );

    it('replaces the roles, records who assigned them and audits the change', async () => {
      const actor = await insertUser('STAFF', { roleIds: [SUPERADMIN] });
      const staff = await insertUser('STAFF', { roleIds: [OPERATOR] });

      await replace(actor, staff, [ADMINISTRATOR, OPERATOR]);

      expect((await queries.findStaff(staff))?.roles).toEqual([
        { id: ADMINISTRATOR, name: 'Administrador' },
        { id: OPERATOR, name: 'Operador' },
      ]);
      expect(
        await prisma.userRole.findUnique({
          where: { userId_roleId: { userId: staff, roleId: ADMINISTRATOR } },
        }),
      ).toMatchObject({ assignedBy: actor });
      expect((await auditEntry('staff.roles-replace'))?.changes).toEqual({
        roleIds: {
          from: [OPERATOR],
          to: [ADMINISTRATOR, OPERATOR].sort(),
        },
      });
    });

    it('rejects unknown roles and customers', async () => {
      const actor = await insertUser('STAFF', { roleIds: [SUPERADMIN] });
      const staff = await insertUser('STAFF', { roleIds: [OPERATOR] });
      const customer = await insertUser('CUSTOMER');

      await expect(replace(actor, staff, [newId()])).rejects.toThrow(
        UnknownRolesError,
      );
      await expect(replace(actor, customer, [OPERATOR])).rejects.toThrow(
        NotFoundError,
      );
    });

    it('never takes the superadmin role away from the last active superadmin', async () => {
      const only = await insertUser('STAFF', { roleIds: [SUPERADMIN] });
      await insertUser('STAFF', {
        status: 'SUSPENDED',
        roleIds: [SUPERADMIN],
      });

      await expect(replace(only, only, [ADMINISTRATOR])).rejects.toThrow(
        LastSuperadminError,
      );
    });

    it('takes it away when another active superadmin remains', async () => {
      const first = await insertUser('STAFF', { roleIds: [SUPERADMIN] });
      await insertUser('STAFF', { roleIds: [SUPERADMIN] });

      await replace(first, first, [ADMINISTRATOR]);

      expect((await queries.findStaff(first))?.roles).toEqual([
        { id: ADMINISTRATOR, name: 'Administrador' },
      ]);
    });

    it('lets only one of two superadmins demote the other at the same time', async () => {
      const first = await insertUser('STAFF', { roleIds: [SUPERADMIN] });
      const second = await insertUser('STAFF', { roleIds: [SUPERADMIN] });
      // Hold the superadmin role lock, so both changes queue behind it and then run one after the other.
      const holder = new pg.Client({
        connectionString: process.env.DATABASE_URL,
      });
      await holder.connect();
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM roles WHERE is_superadmin FOR UPDATE');

      const results = Promise.allSettled([
        replace(second, first, [ADMINISTRATOR]),
        replace(first, second, [ADMINISTRATOR]),
      ]);
      await waitForLockWaiters(holder, 2);
      await holder.query('COMMIT');
      await holder.end();
      const [a, b] = await results;

      expect([a.status, b.status].sort()).toEqual(['fulfilled', 'rejected']);
      const rejected = [a, b].find((r) => r.status === 'rejected');
      expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(
        LastSuperadminError,
      );
      expect(
        await prisma.userRole.count({
          where: { roleId: SUPERADMIN, userId: { in: [first, second] } },
        }),
      ).toBe(1);
    });
  });

  describe('staff suspension (UC-IAM-16)', () => {
    const suspend = (actorId: UserId, userId: UserId, version = 1) =>
      run(() =>
        moduleRef
          .get(SuspendStaff)
          .execute({ actorId, userId, reason: 'Salida del equipo', version }),
      );

    it('suspends a staff member and audits the reason', async () => {
      const actor = await insertUser('STAFF', { roleIds: [SUPERADMIN] });
      const staff = await insertUser('STAFF', { roleIds: [OPERATOR] });

      await suspend(actor, staff);

      expect(await queries.findStaff(staff)).toMatchObject({
        status: 'SUSPENDED',
        version: 2,
      });
      expect(await auditEntry('staff.suspend')).toMatchObject({
        resourceId: staff,
        reason: 'Salida del equipo',
        changes: { status: { from: 'ACTIVE', to: 'SUSPENDED' } },
      });
    });

    it('never lets staff suspend themselves', async () => {
      const actor = await insertUser('STAFF', { roleIds: [SUPERADMIN] });
      await insertUser('STAFF', { roleIds: [SUPERADMIN] });

      await expect(suspend(actor, actor)).rejects.toThrow(
        InvalidStateTransitionError,
      );
    });

    it('never suspends the last active superadmin', async () => {
      const actor = await insertUser('STAFF', { roleIds: [ADMINISTRATOR] });
      const only = await insertUser('STAFF', { roleIds: [SUPERADMIN] });

      await expect(suspend(actor, only)).rejects.toThrow(LastSuperadminError);
    });

    it('rejects suspending a suspended account and an outdated version', async () => {
      const actor = await insertUser('STAFF', { roleIds: [SUPERADMIN] });
      const staff = await insertUser('STAFF', {
        status: 'SUSPENDED',
        roleIds: [OPERATOR],
      });

      await expect(suspend(actor, staff)).rejects.toThrow(
        InvalidStateTransitionError,
      );
      await expect(suspend(actor, staff, 7)).rejects.toThrow(
        new VersionConflictError(1),
      );
    });
  });

  describe('customers (UC-IAM-17, UC-IAM-18)', () => {
    const suspend = (userId: UserId, version = 1) =>
      run(() =>
        moduleRef.get(SuspendCustomer).execute({
          actorId: newId(),
          userId,
          reason: 'Reporte de fraude',
          version,
        }),
      );
    const reactivate = (userId: UserId, version: number) =>
      run(() =>
        moduleRef.get(ReactivateCustomer).execute({
          actorId: newId(),
          userId,
          reason: 'Aclarado con el cliente',
          version,
        }),
      );

    it('suspends and reactivates a customer, who keeps the email verification', async () => {
      const customer = await insertUser('CUSTOMER', { emailVerified: true });

      await suspend(customer);
      expect((await queries.findCustomer(customer))?.status).toBe('SUSPENDED');
      await reactivate(customer, 2);

      expect(await queries.findCustomer(customer)).toMatchObject({
        status: 'ACTIVE',
        emailVerified: true,
        version: 3,
      });
      expect(await auditEntry('customers.reactivate')).toMatchObject({
        reason: 'Aclarado con el cliente',
        changes: { status: { from: 'SUSPENDED', to: 'ACTIVE' } },
      });
    });

    it('never reactivates an active or anonymized customer', async () => {
      const active = await insertUser('CUSTOMER');
      const anonymized = await insertUser('CUSTOMER', { status: 'ANONYMIZED' });

      await expect(reactivate(active, 1)).rejects.toThrow(
        InvalidStateTransitionError,
      );
      await expect(reactivate(anonymized, 1)).rejects.toThrow(
        InvalidStateTransitionError,
      );
    });

    it('answers a staff member as a missing customer', async () => {
      const staff = await insertUser('STAFF', { roleIds: [OPERATOR] });

      await expect(suspend(staff)).rejects.toThrow(NotFoundError);
      expect(await queries.findCustomer(staff)).toBeNull();
    });

    it('lists customers with filters, sorted as asked and in pages', async () => {
      await insertUser('CUSTOMER', {
        email: 'zoe@example.com',
        emailVerified: true,
        createdAt: new Date('2026-09-10T10:00:00Z'),
        lastLoginAt: new Date('2026-09-20T10:00:00Z'),
      });
      await insertUser('CUSTOMER', {
        email: 'ana@example.com',
        firstNames: 'Ana María',
        createdAt: new Date('2026-09-15T10:00:00Z'),
      });
      await insertUser('CUSTOMER', {
        status: 'SUSPENDED',
        email: 'bruno@example.com',
        emailVerified: true,
        createdAt: new Date('2026-08-01T10:00:00Z'),
        lastLoginAt: new Date('2026-09-25T10:00:00Z'),
      });
      await insertUser('STAFF', { roleIds: [OPERATOR] });

      const emails = async (
        filter: Parameters<IdentityQueries['listCustomers']>[0],
        sort: Parameters<IdentityQueries['listCustomers']>[1] = [
          { field: 'email', direction: 'asc' },
        ],
      ) =>
        (
          await queries.listCustomers(filter, sort, { page: 1, pageSize: 20 })
        ).items.map((c) => c.email);

      expect(await emails({})).toEqual([
        'ana@example.com',
        'bruno@example.com',
        'zoe@example.com',
      ]);
      expect(await emails({ q: 'MARÍA' })).toEqual(['ana@example.com']);
      expect(await emails({ status: ['SUSPENDED'] })).toEqual([
        'bruno@example.com',
      ]);
      expect(await emails({ emailVerified: false })).toEqual([
        'ana@example.com',
      ]);
      expect(
        await emails({
          createdFrom: new Date('2026-09-01T00:00:00Z'),
          createdTo: new Date('2026-09-12T00:00:00Z'),
        }),
      ).toEqual(['zoe@example.com']);
      expect(
        await emails({}, [{ field: 'lastLoginAt', direction: 'desc' }]),
      ).toEqual(['bruno@example.com', 'zoe@example.com', 'ana@example.com']);

      const secondPage = await queries.listCustomers(
        {},
        [{ field: 'email', direction: 'asc' }],
        { page: 2, pageSize: 2 },
      );
      expect(secondPage.totalItems).toBe(3);
      expect(secondPage.items.map((c) => c.email)).toEqual(['zoe@example.com']);
    });

    it('shows a customer with their addresses, the default first', async () => {
      const customer = await insertUser('CUSTOMER');
      const address = (id: string, isDefault: boolean, createdAt: Date) => ({
        id,
        userId: customer,
        recipientName: 'María López',
        phone: '4431234567',
        street: 'Av. Madero',
        exteriorNumber: '123',
        neighborhood: 'Centro',
        postalCode: '58000',
        stateCode: '16',
        municipalityCode: '16053',
        isDefault,
        createdAt,
      });
      const [older, newer, defaultOne] = [newId(), newId(), newId()];
      await prisma.customerAddress.createMany({
        data: [
          address(older, false, new Date('2026-09-01')),
          address(newer, false, new Date('2026-09-10')),
          address(defaultOne, true, new Date('2026-08-01')),
        ],
      });

      const detail = await queries.findCustomer(customer);

      expect(detail?.addresses.map((a) => a.id)).toEqual([
        defaultOne,
        newer,
        older,
      ]);
      expect(detail?.addresses[0]).toMatchObject({
        stateName: 'Michoacán de Ocampo',
        municipalityName: 'Morelia',
      });
      expect(detail?.orderCount).toBe(0);
    });
  });

  describe('staff listing', () => {
    it('filters by text, status and role, sorted as asked', async () => {
      await insertUser('STAFF', {
        email: 'carla@example.com',
        roleIds: [OPERATOR],
      });
      await insertUser('STAFF', {
        email: 'beto@example.com',
        firstNames: 'Alberto',
        status: 'SUSPENDED',
        roleIds: [ADMINISTRATOR],
      });
      await insertUser('CUSTOMER', { email: 'cliente@example.com' });

      const emails = async (
        filter: Parameters<IdentityQueries['listStaff']>[0],
      ) =>
        (
          await queries.listStaff(
            filter,
            [{ field: 'email', direction: 'asc' }],
            { page: 1, pageSize: 20 },
          )
        ).items.map((s) => s.email);

      expect(await emails({})).toEqual([
        'beto@example.com',
        'carla@example.com',
      ]);
      expect(await emails({ q: 'alberto' })).toEqual(['beto@example.com']);
      expect(await emails({ status: ['ACTIVE'] })).toEqual([
        'carla@example.com',
      ]);
      expect(await emails({ roleId: ADMINISTRATOR })).toEqual([
        'beto@example.com',
      ]);
    });
  });
});

/** Waits until `count` sessions are blocked on a lock, or a few seconds pass. */
async function waitForLockWaiters(
  client: pg.Client,
  count: number,
): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const { rows } = await client.query<{ waiting: string }>(
      "SELECT count(*) AS waiting FROM pg_stat_activity WHERE wait_event_type = 'Lock'",
    );
    if (Number(rows[0].waiting) >= count) return;
    await sleep(100);
  }
}
