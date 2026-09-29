import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { ConfigModule, type ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import pg from 'pg';
import { AppCacheModule } from '../../../platform/cache/app-cache.module.js';
import { ClockModule } from '../../../platform/clock/clock.module.js';
import {
  type EnvironmentVariables,
  validateEnvironment,
} from '../../../platform/config/environment.js';
import { RateLimitingModule } from '../../../platform/http/rate-limiting/rate-limiting.module.js';
import { MailModule } from '../../../platform/mail/mail.module.js';
import { PersistenceModule } from '../../../platform/persistence/persistence.module.js';
import { PrismaService } from '../../../platform/persistence/prisma.service.js';
import {
  DuplicateValueError,
  InvalidStateTransitionError,
  newId,
  NotFoundError,
  VersionConflictError,
} from '../../../shared-kernel/index.js';
import { waitForLockWaiters } from '../../../../test/support/lock-waiters.js';
import { AuditModule } from '../../audit/index.js';
import {
  CreateFirstSuperadmin,
  SuperadminAlreadyExistsError,
} from '../application/create-first-superadmin.use-case.js';
import { CreateStaff } from '../application/create-staff.use-case.js';
import { PasswordHasher } from '../application/password-hasher.js';
import { ReactivateStaff } from '../application/reactivate-staff.use-case.js';
import { SignIn } from '../application/sign-in.use-case.js';
import { UnknownRolesError } from '../domain/identity-errors.js';
import type { RoleId } from '../domain/role.js';
import type { UserId } from '../domain/user.js';
import { IdentityAccessModule } from '../identity-access.module.js';
import { FirstSuperadminCommand } from './first-superadmin.command.js';

/** Roles of the migration `20260928120000_identity_initial_roles` (ADR-0043). */
const SUPERADMIN = '01a0ea00-c750-7792-a69b-a7289f1a8f47' as RoleId;
const OPERATOR = '01a0ea00-c755-706d-9721-83f80a3d8630' as RoleId;
const TEMPORARY_PASSWORD = /^[a-km-np-z2-9]{4}(-[a-km-np-z2-9]{4}){4}$/;
const PASSWORD = 'una frase larga y segura';
const AUDITED = ['staff.create', 'staff.reactivate', 'auth.login'];

/** Staff creation, reactivation and the first superadmin against PostgreSQL 18 (T-131, ADR-0116). */
describe('Staff accounts (T-131)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cls: ClsService;

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
        RateLimitingModule,
        MailModule,
        AuditModule,
        IdentityAccessModule,
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    cls = moduleRef.get(ClsService);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  afterEach(async () => {
    await prisma.refreshToken.deleteMany();
    await prisma.userRole.deleteMany();
    await prisma.user.deleteMany();
    await prisma.auditLog.deleteMany({ where: { action: { in: AUDITED } } });
  });

  function run<T>(work: () => Promise<T>): Promise<T> {
    return cls.run(work);
  }

  /** An existing account, to act as the admin or to take an email. */
  async function insertUser(
    type: 'CUSTOMER' | 'STAFF',
    options: {
      email?: string;
      status?: 'ACTIVE' | 'SUSPENDED';
      roleIds?: RoleId[];
    } = {},
  ): Promise<UserId> {
    const id = newId<'User'>();
    await prisma.user.create({
      data: {
        id,
        type,
        status: options.status ?? 'ACTIVE',
        suspendedAt: options.status === 'SUSPENDED' ? new Date() : null,
        email: options.email ?? `${id}@example.com`,
        firstNames: 'Ana',
        lastNames: 'Pérez',
        passwordHash: await moduleRef.get(PasswordHasher).hash(PASSWORD),
        roles: {
          create: (options.roleIds ?? []).map((roleId) => ({ roleId })),
        },
      },
    });
    return id;
  }

  const create = (
    actorId: UserId | null,
    changes: Partial<{ email: string; roleIds: RoleId[] }> = {},
  ) =>
    run(() =>
      moduleRef.get(CreateStaff).execute({
        actorId,
        email: changes.email ?? `${newId()}@example.com`,
        firstNames: 'Luis',
        lastNames: 'García',
        roleIds: changes.roleIds ?? [OPERATOR],
      }),
    );
  const reactivate = (actorId: UserId, userId: UserId, version = 1) =>
    run(() =>
      moduleRef.get(ReactivateStaff).execute({
        actorId,
        userId,
        reason: 'Revisión terminada',
        version,
      }),
    );
  const signIn = (email: string, password: string) =>
    run(() => moduleRef.get(SignIn).execute({ email, password }));
  const auditOf = (action: string) =>
    prisma.auditLog.findMany({ where: { action } });

  describe('creating staff (UC-IAM-13)', () => {
    it('creates an active account with its roles and a temporary password to change on first sign-in', async () => {
      const admin = await insertUser('STAFF', { roleIds: [SUPERADMIN] });

      const { userId, temporaryPassword } = await create(admin, {
        email: 'Luis.Garcia@Example.com',
      });

      expect(temporaryPassword).toMatch(TEMPORARY_PASSWORD);
      const stored = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        include: { roles: true },
      });
      expect(stored).toMatchObject({
        type: 'STAFF',
        status: 'ACTIVE',
        email: 'luis.garcia@example.com',
        mustChangePassword: true,
        emailVerifiedAt: null,
        version: 1,
      });
      expect(stored.passwordHash).not.toContain(temporaryPassword);
      expect(stored.roles).toEqual([
        expect.objectContaining({ roleId: OPERATOR, assignedBy: admin }),
      ]);
      expect(
        await signIn('luis.garcia@example.com', temporaryPassword),
      ).toMatchObject({ outcome: 'AUTHENTICATED', mustChangePassword: true });
    });

    it('audits the creation without personal data', async () => {
      const admin = await insertUser('STAFF', { roleIds: [SUPERADMIN] });

      const { userId } = await create(admin);

      expect(await auditOf('staff.create')).toEqual([
        expect.objectContaining({
          resourceId: userId,
          changes: {
            email: { changed: true },
            firstNames: { changed: true },
            lastNames: { changed: true },
            roleIds: { from: [], to: [OPERATOR] },
          },
        }),
      ]);
    });

    it("rejects an email another account has, a customer's included, whatever its case", async () => {
      await insertUser('CUSTOMER', { email: 'ana@example.com' });

      await expect(
        create(newId(), { email: 'ANA@example.com' }),
      ).rejects.toThrow(new DuplicateValueError('email'));
    });

    it('rejects roles that do not exist, and creates nothing', async () => {
      await expect(
        create(newId(), { roleIds: [OPERATOR, newId<'Role'>()] }),
      ).rejects.toThrow(UnknownRolesError);
      expect(await prisma.user.count()).toBe(0);
    });
  });

  describe('reactivating staff (UC-IAM-16)', () => {
    it('reactivates with a new temporary password: the old one stops working, the roles stay', async () => {
      const admin = await insertUser('STAFF', { roleIds: [SUPERADMIN] });
      const staff = await insertUser('STAFF', {
        status: 'SUSPENDED',
        roleIds: [OPERATOR],
      });
      const email = `${staff}@example.com`;

      const { temporaryPassword } = await reactivate(admin, staff);

      expect(temporaryPassword).toMatch(TEMPORARY_PASSWORD);
      expect(
        await prisma.user.findUniqueOrThrow({
          where: { id: staff },
          include: { roles: true },
        }),
      ).toMatchObject({
        status: 'ACTIVE',
        suspendedAt: null,
        mustChangePassword: true,
        version: 2,
        roles: [expect.objectContaining({ roleId: OPERATOR })],
      });
      expect(await signIn(email, PASSWORD)).toEqual({
        outcome: 'INVALID_CREDENTIALS',
      });
      expect(await signIn(email, temporaryPassword)).toMatchObject({
        outcome: 'AUTHENTICATED',
        mustChangePassword: true,
      });
      expect(await auditOf('staff.reactivate')).toEqual([
        expect.objectContaining({
          resourceId: staff,
          reason: 'Revisión terminada',
          changes: {
            status: { from: 'SUSPENDED', to: 'ACTIVE' },
            passwordHash: { changed: true },
          },
        }),
      ]);
    });

    it('rejects an active staff member, a stale version and a customer', async () => {
      const admin = await insertUser('STAFF', { roleIds: [SUPERADMIN] });
      const active = await insertUser('STAFF', { roleIds: [OPERATOR] });
      const suspended = await insertUser('STAFF', {
        status: 'SUSPENDED',
        roleIds: [OPERATOR],
      });
      const customer = await insertUser('CUSTOMER', { status: 'SUSPENDED' });

      await expect(reactivate(admin, active)).rejects.toThrow(
        InvalidStateTransitionError,
      );
      await expect(reactivate(admin, suspended, 7)).rejects.toThrow(
        VersionConflictError,
      );
      await expect(reactivate(admin, customer)).rejects.toThrow(NotFoundError);
    });
  });

  describe('the first superadmin (UC-IAM-20)', () => {
    const first = (email = 'admin@example.com') =>
      run(() =>
        moduleRef
          .get(CreateFirstSuperadmin)
          .execute({ email, firstNames: 'Ana', lastNames: 'Pérez' }),
      );

    it('creates a superadmin by the system, with a temporary password', async () => {
      const { userId, temporaryPassword } = await first();

      expect(temporaryPassword).toMatch(TEMPORARY_PASSWORD);
      expect(await prisma.userRole.findMany({ where: { userId } })).toEqual([
        expect.objectContaining({ roleId: SUPERADMIN, assignedBy: null }),
      ]);
      expect(await auditOf('staff.create')).toEqual([
        expect.objectContaining({ actorType: 'SYSTEM', resourceId: userId }),
      ]);
    });

    it('refuses while an active superadmin exists, but not a suspended one', async () => {
      await insertUser('STAFF', {
        status: 'SUSPENDED',
        roleIds: [SUPERADMIN],
      });
      await expect(first()).resolves.toBeDefined();

      await expect(first('otro@example.com')).rejects.toThrow(
        SuperadminAlreadyExistsError,
      );
    });

    it('creates one at most when two run at the same time', async () => {
      // Hold the superadmin role, so both runs queue behind it and then run one after the other.
      const holder = new pg.Client({
        connectionString: process.env.DATABASE_URL,
      });
      await holder.connect();
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM roles WHERE is_superadmin FOR UPDATE');

      const results = Promise.allSettled([
        first('uno@example.com'),
        first('dos@example.com'),
      ]);
      await waitForLockWaiters(2);
      await holder.query('COMMIT');
      await holder.end();
      const settled = await results;

      expect(settled.map((result) => result.status).sort()).toEqual([
        'fulfilled',
        'rejected',
      ]);
      expect(
        await prisma.userRole.count({ where: { roleId: SUPERADMIN } }),
      ).toBe(1);
    });
  });

  describe('the operator command (UC-IAM-20)', () => {
    const VARIABLES: Partial<EnvironmentVariables> = {
      SUPERADMIN_EMAIL: 'admin@example.com',
      SUPERADMIN_FIRST_NAMES: 'Ana',
      SUPERADMIN_LAST_NAMES: 'Pérez',
    };

    function command(variables: Partial<EnvironmentVariables> = VARIABLES) {
      const config = {
        get: (name: keyof EnvironmentVariables) => variables[name],
      } as unknown as ConfigService<EnvironmentVariables, true>;
      return new FirstSuperadminCommand(
        config,
        moduleRef.get(CreateFirstSuperadmin),
        cls,
      );
    }

    function captureLog() {
      const lines: string[] = [];
      const log = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation((message: unknown) => {
          lines.push(String(message));
        });
      const error = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation((message: unknown) => {
          lines.push(String(message));
        });
      return {
        lines,
        restore: () => {
          log.mockRestore();
          error.mockRestore();
        },
      };
    }

    it('shows the temporary password once, on the terminal and never in the log', async () => {
      const output: string[] = [];
      const log = captureLog();

      const code = await command().run((text) => output.push(text));
      log.restore();

      expect(code).toBe(0);
      const [password] =
        output.join('').match(/[a-km-np-z2-9]{4}(-[a-km-np-z2-9]{4}){4}/) ?? [];
      expect(password).toBeDefined();
      expect(output.join('')).toContain(
        'Superadministrador creado: admin@example.com',
      );
      expect(log.lines.join('\n')).not.toContain(password);
      expect(log.lines.join('\n')).toMatch(/First superadmin created: user /);
      expect(
        await signIn('admin@example.com', password as string),
      ).toMatchObject({
        outcome: 'AUTHENTICATED',
        mustChangePassword: true,
      });
    });

    it('asks for the missing variables and creates nothing', async () => {
      const log = captureLog();

      const code = await command({ SUPERADMIN_EMAIL: 'admin@example.com' }).run(
        () => undefined,
      );
      log.restore();

      expect(code).toBe(1);
      expect(log.lines).toContain(
        'Set SUPERADMIN_FIRST_NAMES, SUPERADMIN_LAST_NAMES to create the first superadmin',
      );
      expect(await prisma.user.count()).toBe(0);
    });

    it('ends with code 1 when a superadmin exists or the email is taken', async () => {
      const log = captureLog();
      await insertUser('CUSTOMER', { email: 'admin@example.com' });
      const taken = await command().run(() => undefined);
      await insertUser('STAFF', { roleIds: [SUPERADMIN] });
      const exists = await command({
        ...VARIABLES,
        SUPERADMIN_EMAIL: 'otro@example.com',
      }).run(() => undefined);
      log.restore();

      expect([taken, exists]).toEqual([1, 1]);
      expect(log.lines).toEqual([
        'SUPERADMIN_EMAIL already belongs to an account',
        'An active superadmin already exists: create staff through the API',
      ]);
    });
  });
});
