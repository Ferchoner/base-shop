import { createHash } from 'node:crypto';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import pg from 'pg';
import { AppCacheModule } from '../../../platform/cache/app-cache.module.js';
import { ClockModule } from '../../../platform/clock/clock.module.js';
import { validateEnvironment } from '../../../platform/config/environment.js';
import { EventsModule } from '../../../platform/events/events.module.js';
import { RateLimitingModule } from '../../../platform/http/rate-limiting/rate-limiting.module.js';
import { MailModule } from '../../../platform/mail/mail.module.js';
import { PersistenceModule } from '../../../platform/persistence/persistence.module.js';
import { PrismaService } from '../../../platform/persistence/prisma.service.js';
import {
  newId,
  PERMISSION_CODES,
  type PermissionCode,
} from '../../../shared-kernel/index.js';
import { AuditModule } from '../../audit/index.js';
import { PasswordHasher } from '../application/password-hasher.js';
import { RefreshSession } from '../application/refresh-session.use-case.js';
import { ResolveSignedInAccount } from '../application/resolve-signed-in-account.js';
import { SignIn } from '../application/sign-in.use-case.js';
import { SignOut } from '../application/sign-out.use-case.js';
import { SuspendCustomer } from '../application/suspend-customer.use-case.js';
import { SuspendStaff } from '../application/suspend-staff.use-case.js';
import type { RoleId } from '../domain/role.js';
import type { SessionId } from '../domain/session.js';
import type { UserId, UserStatus, UserType } from '../domain/user.js';
import { IdentityAccessModule } from '../identity-access.module.js';
import { waitForLockWaiters } from '../../../../test/support/lock-waiters.js';

const PASSWORD = 'una frase larga y segura';
/** Operator role of the migration `20260928120000_identity_initial_roles` (ADR-0043). */
const OPERATOR = '01a0ea00-c755-706d-9721-83f80a3d8630' as RoleId;
const OPERATOR_PERMISSIONS: PermissionCode[] = [
  'catalog.read',
  'catalog.write',
  'pricing.read',
  'pricing.write',
  'inventory.read',
  'inventory.write',
  'orders.read',
  'shipping.manage',
  'customers.read',
];
const AUDITED_ACTIONS = [
  'auth.login',
  'auth.logout',
  'auth.refresh-token-reuse',
  'customers.suspend',
  'staff.suspend',
];

/** Sign-in, renewal and sign-out against PostgreSQL 18 (T-120, UC-IAM-04 to 06, ADR-0023, ADR-0114). */
describe('Sessions (T-120)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cls: ClsService;
  let passwordHash: string;

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
        EventsModule,
        IdentityAccessModule,
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    cls = moduleRef.get(ClsService);
    passwordHash = await moduleRef.get(PasswordHasher).hash(PASSWORD);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  afterEach(async () => {
    await prisma.refreshToken.deleteMany();
    await prisma.userRole.deleteMany();
    await prisma.user.deleteMany();
    await prisma.auditLog.deleteMany({
      where: { action: { in: AUDITED_ACTIONS } },
    });
  });

  /** Runs a use case in its own async context, as a request does. */
  function run<T>(work: () => Promise<T>): Promise<T> {
    return cls.run(work);
  }

  async function insertUser(
    type: UserType = 'CUSTOMER',
    options: {
      status?: UserStatus;
      mustChangePassword?: boolean;
      roleIds?: RoleId[];
    } = {},
  ): Promise<{ id: UserId; email: string }> {
    const id = newId<'User'>();
    const email = `${id}@example.com`;
    await prisma.user.create({
      data: {
        id,
        type,
        email,
        firstNames: 'Ana',
        lastNames: 'Pérez',
        passwordHash,
        status: options.status ?? 'ACTIVE',
        suspendedAt: options.status === 'SUSPENDED' ? new Date() : null,
        mustChangePassword: options.mustChangePassword ?? false,
        roles: {
          create: (options.roleIds ?? []).map((roleId) => ({ roleId })),
        },
      },
    });
    return { id, email };
  }

  const signIn = (email: string, password = PASSWORD) =>
    run(() => moduleRef.get(SignIn).execute({ email, password }));
  const refresh = (refreshToken: string) =>
    run(() => moduleRef.get(RefreshSession).execute({ refreshToken }));
  const signOut = (userId: UserId, refreshToken: string) =>
    run(() => moduleRef.get(SignOut).execute({ userId, refreshToken }));
  const resolve = (userId: UserId, sessionId: SessionId) =>
    run(() => moduleRef.get(ResolveSignedInAccount).execute(userId, sessionId));

  /** Signs in and returns the refresh token and its session. */
  async function startSession(
    email: string,
  ): Promise<{ refreshToken: string; sessionId: SessionId }> {
    const result = await signIn(email);
    if (result.outcome !== 'AUTHENTICATED') throw new Error(result.outcome);
    const { refreshToken } = result.tokens;
    return { refreshToken, sessionId: await sessionOf(refreshToken) };
  }

  async function sessionOf(refreshToken: string): Promise<SessionId> {
    const row = await prisma.refreshToken.findUniqueOrThrow({
      where: { tokenHash: sha256(refreshToken) },
    });
    return row.sessionId as SessionId;
  }

  function auditOf(action: string) {
    return prisma.auditLog.findMany({
      where: { action },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    });
  }

  describe('signing in (UC-IAM-04)', () => {
    it('opens a session whose refresh token is stored only as a hash', async () => {
      const customer = await insertUser();

      const result = await signIn(customer.email.toUpperCase());

      expect(result).toMatchObject({
        outcome: 'AUTHENTICATED',
        userId: customer.id,
        mustChangePassword: false,
        tokens: { accessTokenExpiresIn: 900, refreshTokenExpiresIn: 604_800 },
      });
      if (result.outcome !== 'AUTHENTICATED') return;
      expect(result.tokens.refreshToken).toMatch(/^rt_[A-Za-z0-9_-]{43}$/);
      const rows = await prisma.refreshToken.findMany({
        where: { userId: customer.id },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        tokenHash: sha256(result.tokens.refreshToken),
        revokedAt: null,
        replacedById: null,
      });
      const lifetime =
        rows[0].expiresAt.getTime() - rows[0].createdAt.getTime();
      expect(Math.abs(lifetime - 604_800_000)).toBeLessThan(5_000);
    });

    it('records the sign-in without changing the account version, and audits it', async () => {
      const customer = await insertUser();

      await signIn(customer.email);

      const stored = await prisma.user.findUniqueOrThrow({
        where: { id: customer.id },
      });
      expect(stored.lastLoginAt).not.toBeNull();
      // Signing in is activity (ADR-0152).
      expect(stored.lastActiveAt).toEqual(stored.lastLoginAt);
      expect(stored.version).toBe(1);
      expect(await auditOf('auth.login')).toEqual([
        expect.objectContaining({
          result: 'SUCCESS',
          actorType: 'USER',
          actorId: customer.id,
          resourceType: 'user',
          resourceId: customer.id,
        }),
      ]);
    });

    it('fails on a wrong password, an unknown email or a suspended account, and audits each failure', async () => {
      const customer = await insertUser();
      const suspended = await insertUser('CUSTOMER', { status: 'SUSPENDED' });

      expect(await signIn(customer.email, `${PASSWORD}!`)).toEqual({
        outcome: 'INVALID_CREDENTIALS',
      });
      expect(await signIn('nadie@example.com')).toEqual({
        outcome: 'INVALID_CREDENTIALS',
      });
      expect(await signIn(suspended.email)).toEqual({
        outcome: 'ACCOUNT_DISABLED',
      });

      expect(await prisma.refreshToken.count()).toBe(0);
      const failures = await auditOf('auth.login');
      expect(failures.map((entry) => entry.result)).toEqual([
        'DENIED',
        'DENIED',
        'DENIED',
      ]);
      expect(failures.map((entry) => entry.actorType)).toEqual([
        'ANONYMOUS',
        'ANONYMOUS',
        'ANONYMOUS',
      ]);
      expect(failures.map((entry) => entry.resourceId)).toEqual([
        customer.id,
        null,
        suspended.id,
      ]);
    });

    it('signs in a staff member with a temporary password, flagged to change it', async () => {
      const staff = await insertUser('STAFF', {
        mustChangePassword: true,
        roleIds: [OPERATOR],
      });

      expect(await signIn(staff.email)).toMatchObject({
        outcome: 'AUTHENTICATED',
        mustChangePassword: true,
      });
    });
  });

  describe('renewing (UC-IAM-05)', () => {
    it('rotates the refresh token into a new one of the same session', async () => {
      const customer = await insertUser();
      const { refreshToken, sessionId } = await startSession(customer.email);

      const result = await refresh(refreshToken);

      expect(result).toMatchObject({
        outcome: 'RENEWED',
        userId: customer.id,
        mustChangePassword: false,
      });
      if (result.outcome !== 'RENEWED') return;
      expect(result.tokens.refreshToken).not.toBe(refreshToken);
      const next = await prisma.refreshToken.findUniqueOrThrow({
        where: { tokenHash: sha256(result.tokens.refreshToken) },
      });
      expect(next).toMatchObject({ sessionId, revokedAt: null });
      expect(
        await prisma.refreshToken.findUniqueOrThrow({
          where: { tokenHash: sha256(refreshToken) },
        }),
      ).toMatchObject({ replacedById: next.id, revokedAt: expect.any(Date) });
      expect(await resolve(customer.id, sessionId)).not.toBeNull();
    });

    it('records the renewal as activity once a day at most, without changing the account version (ADR-0152)', async () => {
      const customer = await insertUser();
      const { refreshToken } = await startSession(customer.email);
      const activityOf = async () =>
        (
          await prisma.user.findUniqueOrThrow({
            where: { id: customer.id },
            select: { lastActiveAt: true, version: true },
          })
        ).lastActiveAt;
      const dayAgo = new Date(Date.now() - 86_400_000);
      await prisma.user.update({
        where: { id: customer.id },
        data: { lastActiveAt: dayAgo },
      });

      const renewed = await refresh(refreshToken);

      const active = await activityOf();
      expect(active.getTime()).toBeGreaterThan(dayAgo.getTime());
      if (renewed.outcome !== 'RENEWED') throw new Error(renewed.outcome);
      const recently = new Date(Date.now() - 86_000_000);
      await prisma.user.update({
        where: { id: customer.id },
        data: { lastActiveAt: recently },
      });
      await refresh(renewed.tokens.refreshToken);
      expect(await activityOf()).toEqual(recently);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: customer.id } }))
          .version,
      ).toBe(1);
    });

    it('records no activity for a token that is not renewed', async () => {
      const customer = await insertUser();
      const { refreshToken } = await startSession(customer.email);
      const longAgo = new Date('2026-01-01T00:00:00.000Z');
      await prisma.user.update({
        where: { id: customer.id },
        data: { lastActiveAt: longAgo, status: 'SUSPENDED' },
      });

      expect((await refresh(refreshToken)).outcome).not.toBe('RENEWED');
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: customer.id } }))
          .lastActiveAt,
      ).toEqual(longAgo);
    });

    it('revokes the whole session when a rotated token comes back, and audits the reuse', async () => {
      const customer = await insertUser();
      const { refreshToken, sessionId } = await startSession(customer.email);
      const renewed = await refresh(refreshToken);
      if (renewed.outcome !== 'RENEWED') throw new Error(renewed.outcome);

      expect(await refresh(refreshToken)).toEqual({ outcome: 'INVALID' });

      expect(await refresh(renewed.tokens.refreshToken)).toEqual({
        outcome: 'INVALID',
      });
      expect(await resolve(customer.id, sessionId)).toBeNull();
      expect(await auditOf('auth.refresh-token-reuse')).toEqual([
        expect.objectContaining({
          result: 'DENIED',
          actorType: 'ANONYMOUS',
          resourceId: customer.id,
        }),
      ]);
    });

    it('leaves the other sessions of the user alone on a reuse', async () => {
      const customer = await insertUser();
      const stolen = await startSession(customer.email);
      const other = await startSession(customer.email);
      await refresh(stolen.refreshToken);

      await refresh(stolen.refreshToken);

      expect(await resolve(customer.id, stolen.sessionId)).toBeNull();
      expect(await resolve(customer.id, other.sessionId)).not.toBeNull();
    });

    it('rejects an unknown or expired token, which is not a reuse', async () => {
      const customer = await insertUser();
      const { refreshToken } = await startSession(customer.email);
      await prisma.refreshToken.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      expect(await refresh(`rt_${'x'.repeat(43)}`)).toEqual({
        outcome: 'INVALID',
      });
      expect(await refresh(refreshToken)).toEqual({ outcome: 'INVALID' });
      expect(await auditOf('auth.refresh-token-reuse')).toEqual([]);
    });

    it('rejects renewing for an account suspended meanwhile', async () => {
      const customer = await insertUser();
      const { refreshToken } = await startSession(customer.email);
      await prisma.user.update({
        where: { id: customer.id },
        data: { status: 'SUSPENDED', suspendedAt: new Date() },
      });

      expect(await refresh(refreshToken)).toEqual({ outcome: 'INVALID' });
    });

    it('lets only one of two simultaneous renewals with the same token through; the other is a reuse', async () => {
      const customer = await insertUser();
      const { refreshToken, sessionId } = await startSession(customer.email);
      // Hold the token row, so both renewals queue behind it and then run one after the other.
      const holder = new pg.Client({
        connectionString: process.env.DATABASE_URL,
      });
      await holder.connect();
      await holder.query('BEGIN');
      await holder.query(
        'SELECT id FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE',
        [sha256(refreshToken)],
      );

      const results = Promise.all([
        refresh(refreshToken),
        refresh(refreshToken),
      ]);
      await waitForLockWaiters(2);
      await holder.query('COMMIT');
      await holder.end();
      const outcomes = (await results).map((result) => result.outcome);

      expect(outcomes.sort()).toEqual(['INVALID', 'RENEWED']);
      expect(await resolve(customer.id, sessionId)).toBeNull();
    });
  });

  describe('signing out (UC-IAM-06)', () => {
    it("revokes the refresh token's session for its owner only, once", async () => {
      const customer = await insertUser();
      const stranger = await insertUser();
      const first = await startSession(customer.email);
      const second = await startSession(customer.email);

      await signOut(stranger.id, first.refreshToken);
      expect(await resolve(customer.id, first.sessionId)).not.toBeNull();

      await signOut(customer.id, first.refreshToken);
      await signOut(customer.id, first.refreshToken);

      expect(await resolve(customer.id, first.sessionId)).toBeNull();
      expect(await refresh(first.refreshToken)).toEqual({ outcome: 'INVALID' });
      expect(await resolve(customer.id, second.sessionId)).not.toBeNull();
      expect(await auditOf('auth.logout')).toEqual([
        expect.objectContaining({ result: 'SUCCESS', resourceId: customer.id }),
      ]);
    });
  });

  describe('suspending (ADR-0023)', () => {
    it('revokes every session of a suspended customer in the same change', async () => {
      const customer = await insertUser();
      const sessions = [
        await startSession(customer.email),
        await startSession(customer.email),
      ];

      await run(() =>
        moduleRef.get(SuspendCustomer).execute({
          actorId: newId(),
          userId: customer.id,
          reason: 'Fraude reportado',
          version: 1,
        }),
      );

      for (const { refreshToken, sessionId } of sessions) {
        expect(await resolve(customer.id, sessionId)).toBeNull();
        expect(await refresh(refreshToken)).toEqual({ outcome: 'INVALID' });
      }
      expect(
        await prisma.refreshToken.count({ where: { revokedAt: null } }),
      ).toBe(0);
    });

    it('revokes every session of a suspended staff member', async () => {
      const staff = await insertUser('STAFF', { roleIds: [OPERATOR] });
      const { sessionId } = await startSession(staff.email);

      await run(() =>
        moduleRef.get(SuspendStaff).execute({
          actorId: newId(),
          userId: staff.id,
          reason: 'Salida de la empresa',
          version: 1,
        }),
      );

      expect(await resolve(staff.id, sessionId)).toBeNull();
      expect(
        await prisma.refreshToken.count({ where: { revokedAt: null } }),
      ).toBe(0);
    });
  });

  describe('resolving an access token (ADR-0114)', () => {
    it('reads the account, its permissions in catalog order and the session', async () => {
      const staff = await insertUser('STAFF', { roleIds: [OPERATOR] });
      const { sessionId } = await startSession(staff.email);

      expect(await resolve(staff.id, sessionId)).toEqual({
        id: staff.id,
        type: 'STAFF',
        permissions: PERMISSION_CODES.filter((code) =>
          OPERATOR_PERMISSIONS.includes(code),
        ),
        mustChangePassword: false,
        sessionId,
      });
    });

    it('gives customers no permissions', async () => {
      const customer = await insertUser();
      const { sessionId } = await startSession(customer.email);

      expect(await resolve(customer.id, sessionId)).toMatchObject({
        type: 'CUSTOMER',
        permissions: [],
      });
    });

    it('answers null for an unknown session, another user, an expired session or an inactive account', async () => {
      const customer = await insertUser();
      const other = await insertUser();
      const { sessionId } = await startSession(customer.email);

      expect(await resolve(customer.id, newId())).toBeNull();
      expect(await resolve(other.id, sessionId)).toBeNull();

      await prisma.user.update({
        where: { id: customer.id },
        data: { status: 'SUSPENDED', suspendedAt: new Date() },
      });
      expect(await resolve(customer.id, sessionId)).toBeNull();

      await prisma.user.update({
        where: { id: customer.id },
        data: { status: 'ACTIVE', suspendedAt: null },
      });
      expect(await resolve(customer.id, sessionId)).not.toBeNull();
      await prisma.refreshToken.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      expect(await resolve(customer.id, sessionId)).toBeNull();
    });
  });
});

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
