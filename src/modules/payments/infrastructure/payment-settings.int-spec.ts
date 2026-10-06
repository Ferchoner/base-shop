import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import pg from 'pg';
import { waitForLockWaiters } from '../../../../test/support/lock-waiters.js';
import { ClockModule } from '../../../platform/clock/clock.module.js';
import { validateEnvironment } from '../../../platform/config/environment.js';
import { EventsModule } from '../../../platform/events/events.module.js';
import { PersistenceModule } from '../../../platform/persistence/persistence.module.js';
import { PrismaService } from '../../../platform/persistence/prisma.service.js';
import { newId, VersionConflictError } from '../../../shared-kernel/index.js';
import { AuditModule } from '../../audit/index.js';
import { ConfigurePaymentSettings } from '../application/configure-payment-settings.use-case.js';
import { PaymentsFacade } from '../application/payments.facade.js';
import { PaymentsQueries } from '../application/payments.queries.js';
import { PaymentSettingsRepository } from '../domain/payment-settings.repository.js';
import { PaymentsModule } from '../payments.module.js';

/** The only row of the settings, which the migration creates. */
const SETTINGS_ID = '01a11302-41ef-7d33-9e36-93a5239b19ba';

/** Manual payments enabled from the API, against PostgreSQL 18 (T-194, ADR-0162). */
describe('Payments: settings (T-194)', () => {
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
        EventsModule,
        AuditModule,
        PaymentsModule,
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    cls = moduleRef.get(ClsService);
  });

  afterEach(async () => {
    // Off again, as the migration leaves them, so each test starts from there.
    await prisma.paymentSettings.update({
      where: { id: SETTINGS_ID },
      data: { manualPaymentsEnabled: false },
    });
    await prisma.auditLog.deleteMany({
      where: { action: 'payment-settings.update' },
    });
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  const currentVersion = async () =>
    (
      await prisma.paymentSettings.findUniqueOrThrow({
        where: { id: SETTINGS_ID },
      })
    ).version;

  const configure = (manualPaymentsEnabled: boolean, version: number) =>
    cls.run(() =>
      moduleRef
        .get(ConfigurePaymentSettings)
        .execute({ manualPaymentsEnabled, version }),
    );

  it('starts with the one row the migration creates, with manual payments off (ADR-0040)', async () => {
    expect(await prisma.paymentSettings.findMany()).toEqual([
      expect.objectContaining({
        id: SETTINGS_ID,
        manualPaymentsEnabled: false,
      }),
    ]);
    expect(await moduleRef.get(PaymentsQueries).findSettings()).toEqual({
      manualPaymentsEnabled: false,
      version: await currentVersion(),
      updatedAt: expect.any(Date),
    });
    expect(
      await cls.run(() =>
        moduleRef.get(PaymentsFacade).manualPaymentsEnabled(),
      ),
    ).toBe(false);
  });

  it('keeps a single row: the CHECK rejects any other', async () => {
    await expect(
      prisma.$executeRaw`INSERT INTO payment_settings (id, manual_payments_enabled, updated_at)
        VALUES (${newId()}::uuid, true, now())`,
    ).rejects.toThrow(/payment_settings_single_row_check/);
    expect(await prisma.paymentSettings.count()).toBe(1);
  });

  it('turns manual payments on with optimistic locking, audits it, and the facade sees it at once', async () => {
    const version = await currentVersion();
    const before = await moduleRef.get(PaymentsQueries).findSettings();

    await configure(true, version);

    const after = await moduleRef.get(PaymentsQueries).findSettings();
    expect(after).toMatchObject({
      manualPaymentsEnabled: true,
      version: version + 1,
    });
    expect(after.updatedAt.getTime()).toBeGreaterThan(
      before.updatedAt.getTime(),
    );
    expect(
      await cls.run(() =>
        moduleRef.get(PaymentsFacade).manualPaymentsEnabled(),
      ),
    ).toBe(true);
    expect(
      await prisma.auditLog.findMany({
        where: { action: 'payment-settings.update' },
        select: { resourceType: true, resourceId: true, changes: true },
      }),
    ).toEqual([
      {
        resourceType: 'payment-settings',
        resourceId: SETTINGS_ID,
        changes: { manualPaymentsEnabled: { from: false, to: true } },
      },
    ]);
  });

  it('rejects a change made on an older version', async () => {
    const version = await currentVersion();
    await configure(true, version);

    await expect(configure(false, version)).rejects.toEqual(
      new VersionConflictError(version + 1),
    );
    expect(
      await cls.run(() =>
        moduleRef.get(PaymentsFacade).manualPaymentsEnabled(),
      ),
    ).toBe(true);
  });

  it('lets only one of two changes on the same version win, even when both reach the save together', async () => {
    const version = await currentVersion();
    // Hold the row, so both changes read the same version and then wait to save it: only the version in the
    // UPDATE can tell them apart.
    const holder = new pg.Client({
      connectionString: process.env.DATABASE_URL,
    });
    await holder.connect();
    await holder.query('BEGIN');
    await holder.query(
      'SELECT id FROM payment_settings WHERE id = $1 FOR UPDATE',
      [SETTINGS_ID],
    );

    const results = Promise.allSettled([
      configure(true, version),
      configure(true, version),
    ]);
    await waitForLockWaiters(2);
    await holder.query('COMMIT');
    await holder.end();
    const settled = await results;

    expect(settled.map(({ status }) => status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    const rejected = settled.find(({ status }) => status === 'rejected');
    expect((rejected as PromiseRejectedResult).reason).toEqual(
      new VersionConflictError(version + 1),
    );
    expect(await currentVersion()).toBe(version + 1);
  });

  it('leaves the saved settings at their new version', async () => {
    const repository = moduleRef.get(PaymentSettingsRepository);
    const settings = await cls.run(() => repository.find());
    const { version } = settings;
    settings.setManualPayments(true);

    await cls.run(() => repository.save(settings));

    expect(settings.version).toBe(version + 1);
    expect(await currentVersion()).toBe(version + 1);
  });

  it('saves and audits nothing when nothing changes', async () => {
    const version = await currentVersion();

    await configure(false, version);

    expect(await currentVersion()).toBe(version);
    expect(
      await prisma.auditLog.count({
        where: { action: 'payment-settings.update' },
      }),
    ).toBe(0);
  });
});
