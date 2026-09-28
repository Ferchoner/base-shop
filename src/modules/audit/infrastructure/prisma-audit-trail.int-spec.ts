import { randomUUID } from 'node:crypto';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { CLS_ID, CLS_REQ, ClsModule, ClsService } from 'nestjs-cls';
import { ClockModule } from '../../../platform/clock/clock.module.js';
import { validateEnvironment } from '../../../platform/config/environment.js';
import { PersistenceModule } from '../../../platform/persistence/persistence.module.js';
import { PrismaService } from '../../../platform/persistence/prisma.service.js';
import {
  AuditTrail,
  changesBetween,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import { AuditModule } from '../audit.module.js';

const ACTION_PREFIX = 'audit-test.';

/**
 * Audit trail (T-127, ADR-0100): entries commit with the audited change, take who and where from the
 * request, and never keep personal or sensitive values.
 */
describe('PrismaAuditTrail (T-127)', () => {
  let moduleRef: TestingModule;
  let audit: AuditTrail;
  let transactions: TransactionManager;
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
        AuditModule,
      ],
    }).compile();
    await moduleRef.init();
    audit = moduleRef.get(AuditTrail);
    transactions = moduleRef.get(TransactionManager);
    prisma = moduleRef.get(PrismaService);
    cls = moduleRef.get(ClsService);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  afterEach(async () => {
    await prisma.auditLog.deleteMany({
      where: { action: { startsWith: ACTION_PREFIX } },
    });
  });

  const entries = () =>
    prisma.auditLog.findMany({
      where: { action: { startsWith: ACTION_PREFIX } },
      orderBy: { id: 'asc' },
    });

  /** Runs `work` as if it happened while handling an HTTP request. */
  function withinRequest<T>(
    request: { ip?: string; headers?: Record<string, string>; user?: unknown },
    work: () => Promise<T>,
  ): Promise<T> {
    return cls.run(async () => {
      cls.set(CLS_ID, 'request-correlation-id');
      cls.set(CLS_REQ, request);
      return work();
    });
  }

  it('commits the entry together with the audited change', async () => {
    await transactions.run(async () => {
      await audit.record({
        action: `${ACTION_PREFIX}commit`,
        resource: { type: 'order', id: 'order-1' },
      });
    });

    const [entry] = await entries();
    expect(entry).toMatchObject({
      action: `${ACTION_PREFIX}commit`,
      resourceType: 'order',
      resourceId: 'order-1',
      result: 'SUCCESS',
    });
    expect(entry.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rolls the entry back with the change', async () => {
    await expect(
      transactions.run(async () => {
        await audit.record({ action: `${ACTION_PREFIX}rollback` });
        throw new Error('change failed');
      }),
    ).rejects.toThrow('change failed');

    expect(await entries()).toHaveLength(0);
  });

  it('keeps an independent entry even when the transaction rolls back', async () => {
    await expect(
      transactions.run(async () => {
        await audit.recordIndependently({
          action: `${ACTION_PREFIX}denied`,
          result: 'DENIED',
        });
        throw new Error('change failed');
      }),
    ).rejects.toThrow('change failed');

    const [entry] = await entries();
    expect(entry.result).toBe('DENIED');
  });

  it('takes the actor, IP, user agent and correlation id from the request', async () => {
    const userId = randomUUID();

    await withinRequest(
      {
        ip: '::ffff:192.0.2.10',
        headers: { 'user-agent': 'Mozilla/5.0 (test)' },
        user: { id: userId },
      },
      () => audit.record({ action: `${ACTION_PREFIX}request` }),
    );

    const [entry] = await entries();
    expect(entry).toMatchObject({
      actorType: 'USER',
      actorId: userId,
      correlationId: 'request-correlation-id',
      userAgent: 'Mozilla/5.0 (test)',
    });
    expect(entry.ip).toContain('192.0.2.10');
  });

  it('records ANONYMOUS inside a request without a user, and SYSTEM outside a request', async () => {
    await withinRequest({}, () =>
      audit.record({ action: `${ACTION_PREFIX}anonymous` }),
    );
    await audit.record({ action: `${ACTION_PREFIX}system` });

    const recorded = await entries();
    expect(recorded.map((entry) => [entry.action, entry.actorType])).toEqual([
      [`${ACTION_PREFIX}anonymous`, 'ANONYMOUS'],
      [`${ACTION_PREFIX}system`, 'SYSTEM'],
    ]);
    expect(recorded[1].correlationId).toBeNull();
  });

  it('uses an explicit actor, such as ANONYMOUS on a failed login', async () => {
    await withinRequest({ user: { id: randomUUID() } }, () =>
      audit.recordIndependently({
        action: `${ACTION_PREFIX}login-failed`,
        result: 'FAILED',
        actor: { type: 'ANONYMOUS' },
      }),
    );

    const [entry] = await entries();
    expect(entry).toMatchObject({ actorType: 'ANONYMOUS', actorId: null });
  });

  it('ignores an IP that is not an address', async () => {
    await withinRequest({ ip: 'not-an-ip' }, () =>
      audit.record({ action: `${ACTION_PREFIX}ip` }),
    );

    const [entry] = await entries();
    expect(entry.ip).toBeNull();
  });

  it('stores changed fields without personal or sensitive values', async () => {
    await audit.record({
      action: `${ACTION_PREFIX}changes`,
      changes: {
        ...changesBetween(
          { status: 'ACTIVE', contactEmail: 'ana@example.com' },
          { status: 'SUSPENDED', contactEmail: 'luis@example.com' },
        ),
        passwordHash: { from: 'old-hash', to: 'new-hash' },
      },
    });

    const [entry] = await entries();
    expect(entry.changes).toEqual({
      status: { from: 'ACTIVE', to: 'SUSPENDED' },
      contactEmail: { changed: true },
      passwordHash: { changed: true },
    });
    expect(JSON.stringify(entry.changes)).not.toMatch(/example\.com|hash"/);
  });

  it('rejects an action that is not a stable code', async () => {
    await expect(audit.record({ action: 'Cancel Order' })).rejects.toThrow(
      /stable code/,
    );
  });

  describe('reason (ADR-0112)', () => {
    it('keeps the reason a staff member gave, apart from the changes', async () => {
      await audit.record({
        action: `${ACTION_PREFIX}suspend`,
        changes: { status: { from: 'ACTIVE', to: 'SUSPENDED' } },
        reason: 'Acceso desde un equipo no autorizado',
      });

      const [entry] = await entries();
      expect(entry.reason).toBe('Acceso desde un equipo no autorizado');
      expect(entry.changes).toEqual({
        status: { from: 'ACTIVE', to: 'SUSPENDED' },
      });
    });

    it('leaves it empty for actions without a reason', async () => {
      await audit.record({ action: `${ACTION_PREFIX}no-reason` });

      expect((await entries())[0].reason).toBeNull();
    });

    it.each(['', 'x'.repeat(501)])(
      'is rejected by the database outside 1 to 500 characters (%#)',
      async (reason) => {
        await expect(
          audit.record({ action: `${ACTION_PREFIX}bad-reason`, reason }),
        ).rejects.toThrow(/audit_logs_reason_check/);
      },
    );
  });
});
