import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import { ClockModule } from '../../../platform/clock/clock.module.js';
import { validateEnvironment } from '../../../platform/config/environment.js';
import { PersistenceModule } from '../../../platform/persistence/persistence.module.js';
import { PrismaService } from '../../../platform/persistence/prisma.service.js';
import {
  newId,
  PERMISSION_CODES,
  TransactionManager,
  VersionConflictError,
} from '../../../shared-kernel/index.js';
import { AuditModule } from '../../audit/index.js';
import { IdentityAccessFacade } from '../application/identity-access.facade.js';
import { Role, type RoleId } from '../domain/role.js';
import { RoleRepository } from '../domain/role.repository.js';
import type { UserId, UserStatus, UserType } from '../domain/user.js';
import { UserRepository } from '../domain/user.repository.js';
import { IdentityAccessModule } from '../identity-access.module.js';

/** Roles created by the migration `20260928120000_identity_initial_roles` (ADR-0043). */
const SUPERADMIN = '01a0ea00-c750-7792-a69b-a7289f1a8f47' as RoleId;
const ADMINISTRATOR = '01a0ea00-c755-706d-9721-7e4a48b61d77' as RoleId;
const OPERATOR = '01a0ea00-c755-706d-9721-83f80a3d8630' as RoleId;

/** Users, roles and permissions of Identity & Access against PostgreSQL 18 (T-130, ADR-0111). */
describe('Identity & Access persistence (T-130)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cls: ClsService;
  let transactions: TransactionManager;
  let users: UserRepository;
  let roles: RoleRepository;
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
        AuditModule,
        IdentityAccessModule,
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    cls = moduleRef.get(ClsService);
    transactions = moduleRef.get(TransactionManager);
    users = moduleRef.get(UserRepository);
    roles = moduleRef.get(RoleRepository);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  afterEach(async () => {
    await prisma.userRole.deleteMany();
    await prisma.user.deleteMany();
    await prisma.role.deleteMany({ where: { id: { in: createdRoles } } });
  });

  /** Runs `work` in a transaction, as a use case does. */
  function inTransaction<T>(work: () => Promise<T>): Promise<T> {
    return cls.run(() => transactions.run(work));
  }

  async function insertUser(
    type: UserType,
    options: { status?: UserStatus; roleIds?: RoleId[] } = {},
  ): Promise<UserId> {
    const id = newId<'User'>();
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

  describe('initial roles (ADR-0043)', () => {
    it('creates Superadministrador, Administrador and Operador', async () => {
      const stored = await prisma.role.findMany({
        where: { id: { in: [SUPERADMIN, ADMINISTRATOR, OPERATOR] } },
        orderBy: { name: 'asc' },
        select: { name: true, isSuperadmin: true },
      });

      expect(stored).toEqual([
        { name: 'Administrador', isSuperadmin: false },
        { name: 'Operador', isSuperadmin: false },
        { name: 'Superadministrador', isSuperadmin: true },
      ]);
    });

    it('gives each role the permissions of ADR-0043 and ADR-0075', async () => {
      const [superadmin, administrator, operator] = await roles
        .findByIds([SUPERADMIN, ADMINISTRATOR, OPERATOR])
        .then((found) =>
          [SUPERADMIN, ADMINISTRATOR, OPERATOR].map((id) =>
            found.find((role) => role.id === id)!,
          ),
        );

      expect(superadmin.snapshot().permissions).toEqual([]);
      expect(superadmin.effectivePermissions()).toEqual(PERMISSION_CODES);
      expect([...administrator.effectivePermissions()].sort()).toEqual(
        PERMISSION_CODES.filter((code) => code !== 'staff.manage').sort(),
      );
      expect([...operator.effectivePermissions()].sort()).toEqual(
        [
          'catalog.read',
          'catalog.write',
          'customers.read',
          'inventory.read',
          'inventory.write',
          'orders.read',
          'pricing.read',
          'pricing.write',
          'shipping.manage',
        ].sort(),
      );
    });
  });

  describe('RoleRepository', () => {
    it('creates a role with its permissions and saves later changes with a new version', async () => {
      const role = Role.create({
        id: newId(),
        name: 'Soporte',
        description: null,
        permissions: ['customers.read', 'orders.read'],
      });
      createdRoles.push(role.id);

      await inTransaction(() => roles.save(role));
      role.rename('Atención a clientes');
      role.replacePermissions(['customers.read']);
      await inTransaction(() => roles.save(role));

      const stored = await inTransaction(() => roles.findById(role.id));
      expect(stored?.snapshot()).toMatchObject({
        name: 'Atención a clientes',
        permissions: ['customers.read'],
        version: 2,
      });
      expect(role.version).toBe(2);
    });

    it('rejects a change based on an outdated version', async () => {
      const role = Role.create({
        id: newId(),
        name: 'Soporte',
        description: null,
        permissions: [],
      });
      createdRoles.push(role.id);
      await inTransaction(() => roles.save(role));
      const first = (await inTransaction(() => roles.findById(role.id)))!;
      const second = (await inTransaction(() => roles.findById(role.id)))!;

      first.rename('Primero');
      await inTransaction(() => roles.save(first));
      second.rename('Segundo');

      await expect(inTransaction(() => roles.save(second))).rejects.toThrow(
        new VersionConflictError(2),
      );
      expect(
        (await prisma.role.findUnique({ where: { id: role.id } }))?.name,
      ).toBe('Primero');
    });
  });

  describe('UserRepository', () => {
    it('saves a suspension and increments the version', async () => {
      const id = await insertUser('CUSTOMER');
      const at = new Date('2026-09-28T12:00:00.000Z');

      await inTransaction(async () => {
        const user = (await users.findById(id))!;
        user.suspend(at);
        await users.save(user, null);
      });

      expect(await prisma.user.findUnique({ where: { id } })).toMatchObject({
        status: 'SUSPENDED',
        suspendedAt: at,
        version: 2,
      });
    });

    it('rejects a change based on an outdated version, with the current one', async () => {
      const id = await insertUser('CUSTOMER');
      const stale = (await inTransaction(() => users.findById(id)))!;
      await prisma.user.update({ where: { id }, data: { version: 5 } });

      stale.suspend(new Date());

      await expect(
        inTransaction(() => users.save(stale, null)),
      ).rejects.toThrow(new VersionConflictError(5));
      expect((await prisma.user.findUnique({ where: { id } }))?.status).toBe(
        'ACTIVE',
      );
    });

    it('replaces the roles of a staff member and records who assigned them', async () => {
      const assigner = await insertUser('STAFF', { roleIds: [SUPERADMIN] });
      const id = await insertUser('STAFF', { roleIds: [OPERATOR] });

      await inTransaction(async () => {
        const user = (await users.findById(id))!;
        user.replaceRoles([ADMINISTRATOR, OPERATOR]);
        await users.save(user, assigner);
      });
      await inTransaction(async () => {
        const user = (await users.findById(id))!;
        user.replaceRoles([ADMINISTRATOR]);
        await users.save(user, assigner);
      });

      const assignments = await prisma.userRole.findMany({
        where: { userId: id },
      });
      expect(assignments).toEqual([
        expect.objectContaining({
          roleId: ADMINISTRATOR,
          assignedBy: assigner,
        }),
      ]);
    });
  });

  describe('IdentityAccessFacade.permissionsOf (ADR-0111)', () => {
    const permissionsOf = (id: UserId) =>
      moduleRef.get(IdentityAccessFacade).permissionsOf(id);

    it('gives the superadmin every permission', async () => {
      const id = await insertUser('STAFF', { roleIds: [SUPERADMIN] });

      expect(await permissionsOf(id)).toEqual(PERMISSION_CODES);
    });

    it('joins the permissions of every role, without repeats', async () => {
      const id = await insertUser('STAFF', {
        roleIds: [ADMINISTRATOR, OPERATOR],
      });

      const permissions = await permissionsOf(id);

      expect([...permissions].sort()).toEqual(
        PERMISSION_CODES.filter((code) => code !== 'staff.manage').sort(),
      );
    });

    it('gives none to customers, suspended staff and unknown users', async () => {
      const customer = await insertUser('CUSTOMER');
      const suspended = await insertUser('STAFF', {
        status: 'SUSPENDED',
        roleIds: [SUPERADMIN],
      });

      expect(await permissionsOf(customer)).toEqual([]);
      expect(await permissionsOf(suspended)).toEqual([]);
      expect(await permissionsOf(newId())).toEqual([]);
    });
  });
});
