import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import pg from 'pg';
import { waitForLockWaiters } from '../../../../test/support/lock-waiters.js';
import { ClockModule } from '../../../platform/clock/clock.module.js';
import { validateEnvironment } from '../../../platform/config/environment.js';
import { PersistenceModule } from '../../../platform/persistence/persistence.module.js';
import { PrismaService } from '../../../platform/persistence/prisma.service.js';
import {
  Money,
  NotFoundError,
  VersionConflictError,
} from '../../../shared-kernel/index.js';
import { AuditModule } from '../../audit/index.js';
import { ConfigureShippingMethod } from '../application/configure-shipping-method.use-case.js';
import { ShippingFacade } from '../application/shipping.facade.js';
import { ShippingQueries } from '../application/shipping.queries.js';
import { ShippingMethodRepository } from '../domain/shipping-method.repository.js';
import { ShippingModule } from '../shipping.module.js';

/** The method the migration creates, with the provisional values of ADR-0092. */
const SEEDED_ID = '01a0f401-1b74-71ec-b896-7680a8d24293';
interface Settings {
  name: string;
  flatFee: number;
  freeShippingThreshold: number | null;
  deliveryMinBusinessDays: number;
  deliveryMaxBusinessDays: number;
}

const SEEDED: Settings = {
  name: 'Envío Estándar',
  flatFee: 9_900,
  freeShippingThreshold: 150_000,
  deliveryMinBusinessDays: 3,
  deliveryMaxBusinessDays: 7,
};
const MIGRATION = path.join(
  process.cwd(),
  'prisma',
  'migrations',
  '20260930120000_shipping_initial_method',
  'migration.sql',
);

const mxn = (amount: number) => Money.of(amount, 'MXN');

/** The shipping method against PostgreSQL 18 (T-196, ADR-0122). */
describe('Shipping method (T-196)', () => {
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
        AuditModule,
        ShippingModule,
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    cls = moduleRef.get(ClsService);
  });

  afterEach(async () => {
    // Back to the values of the migration, so each test starts from them.
    await prisma.shippingMethod.update({
      where: { id: SEEDED_ID },
      data: SEEDED,
    });
    await prisma.auditLog.deleteMany({
      where: { action: 'shipping-method.update' },
    });
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  const currentVersion = async () =>
    (
      await prisma.shippingMethod.findUniqueOrThrow({
        where: { id: SEEDED_ID },
      })
    ).version;

  const configure = (changes: Partial<Settings> & { version: number }) =>
    cls.run(() =>
      moduleRef.get(ConfigureShippingMethod).execute({ ...SEEDED, ...changes }),
    );

  it('starts with the one active method the migration creates (ADR-0092)', async () => {
    const methods = await prisma.shippingMethod.findMany();

    expect(methods).toEqual([
      expect.objectContaining({ id: SEEDED_ID, ...SEEDED, isActive: true }),
    ]);
    expect(
      await moduleRef.get(ShippingQueries).findActiveMethod(),
    ).toMatchObject({
      id: SEEDED_ID,
      name: 'Envío Estándar',
      flatFee: mxn(9_900),
      freeShippingThreshold: mxn(150_000),
      deliveryMinBusinessDays: 3,
      deliveryMaxBusinessDays: 7,
      isActive: true,
    });
  });

  it('never replaces what the administrator configured when the migration runs again', async () => {
    await configure({ flatFee: 12_900, version: await currentVersion() });

    await prisma.$executeRawUnsafe(readFileSync(MIGRATION, 'utf8'));

    const methods = await prisma.shippingMethod.findMany();
    expect(methods).toHaveLength(1);
    expect(methods[0].flatFee).toBe(12_900);
  });

  it('configures every setting with optimistic locking, and audits what changed', async () => {
    const version = await currentVersion();

    await configure({
      name: 'Envío Nacional',
      freeShippingThreshold: null,
      deliveryMaxBusinessDays: 10,
      version,
    });

    expect(
      await moduleRef.get(ShippingQueries).findActiveMethod(),
    ).toMatchObject({
      name: 'Envío Nacional',
      flatFee: mxn(9_900),
      freeShippingThreshold: null,
      deliveryMaxBusinessDays: 10,
      version: version + 1,
    });
    const audit = await prisma.auditLog.findMany({
      where: { action: 'shipping-method.update' },
      select: { resourceType: true, resourceId: true, changes: true },
    });
    expect(audit).toEqual([
      {
        resourceType: 'shipping-method',
        resourceId: SEEDED_ID,
        changes: {
          name: { from: 'Envío Estándar', to: 'Envío Nacional' },
          freeShippingThreshold: { from: 150_000, to: null },
          deliveryMaxBusinessDays: { from: 7, to: 10 },
        },
      },
    ]);
  });

  it('rejects a change made on an older version', async () => {
    const version = await currentVersion();
    await configure({ flatFee: 12_900, version });

    await expect(configure({ flatFee: 5_000, version })).rejects.toEqual(
      new VersionConflictError(version + 1),
    );
    expect(
      (
        await prisma.shippingMethod.findUniqueOrThrow({
          where: { id: SEEDED_ID },
        })
      ).flatFee,
    ).toBe(12_900);
  });

  it('lets only one of two changes on the same version win, even when both reach the save together', async () => {
    const version = await currentVersion();
    // Hold the row, so both changes read the same version and then wait to save it: only the version in
    // the UPDATE can tell them apart.
    const holder = new pg.Client({
      connectionString: process.env.DATABASE_URL,
    });
    await holder.connect();
    await holder.query('BEGIN');
    await holder.query(
      'SELECT id FROM shipping_methods WHERE id = $1 FOR UPDATE',
      [SEEDED_ID],
    );

    const results = Promise.allSettled([
      configure({ flatFee: 10_000, version }),
      configure({ flatFee: 20_000, version }),
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

  it('leaves the saved method at its new version', async () => {
    const repository = moduleRef.get(ShippingMethodRepository);
    const method = await repository.findActive();
    if (method === null) throw new Error('The migration creates the method');
    const { version } = method;
    method.configure({ ...method.snapshot(), name: 'Envío Nacional' });

    await repository.save(method);

    expect(method.version).toBe(version + 1);
    expect(await currentVersion()).toBe(version + 1);
  });

  it('saves and audits nothing when nothing changes', async () => {
    const version = await currentVersion();

    await configure({ version });

    expect(await currentVersion()).toBe(version);
    expect(
      await prisma.auditLog.count({
        where: { action: 'shipping-method.update' },
      }),
    ).toBe(0);
  });

  it('answers a missing method as not found', async () => {
    await prisma.shippingMethod.update({
      where: { id: SEEDED_ID },
      data: { isActive: false },
    });
    try {
      await expect(configure({ version: 1 })).rejects.toThrow(NotFoundError);
    } finally {
      await prisma.shippingMethod.update({
        where: { id: SEEDED_ID },
        data: { isActive: true },
      });
    }
  });

  it('quotes an order with the values in force, never from a cache (UC-SHI-01)', async () => {
    const facade = moduleRef.get(ShippingFacade);
    const before = await facade.quote({
      subtotal: mxn(119_800),
      discount: mxn(0),
    });

    await configure({ flatFee: 12_900, version: await currentVersion() });
    const after = await facade.quote({
      subtotal: mxn(119_800),
      discount: mxn(0),
    });

    expect(before).toMatchObject({
      methodId: SEEDED_ID,
      cost: mxn(9_900),
      taxAmount: mxn(1_366),
      taxRateBp: 1_600,
      freeShippingThreshold: mxn(150_000),
      deliveryMinBusinessDays: 3,
      deliveryMaxBusinessDays: 7,
    });
    expect(after.cost).toEqual(mxn(12_900));
    expect(after.taxAmount).toEqual(mxn(1_779));
  });
});
