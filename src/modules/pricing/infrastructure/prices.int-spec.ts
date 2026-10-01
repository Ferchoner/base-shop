import { readFileSync } from 'node:fs';
import path from 'node:path';
import { jest } from '@jest/globals';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { TransactionHost } from '@nestjs-cls/transactional';
import { ClsModule, ClsService } from 'nestjs-cls';
import pg from 'pg';
import { waitForLockWaiters } from '../../../../test/support/lock-waiters.js';
import { AppCacheModule } from '../../../platform/cache/app-cache.module.js';
import { ClockModule } from '../../../platform/clock/clock.module.js';
import { validateEnvironment } from '../../../platform/config/environment.js';
import { EventsModule } from '../../../platform/events/events.module.js';
import { PersistenceModule } from '../../../platform/persistence/persistence.module.js';
import { PrismaService } from '../../../platform/persistence/prisma.service.js';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import {
  Clock,
  Money,
  newId,
  NotFoundError,
} from '../../../shared-kernel/index.js';
import { AuditModule } from '../../audit/index.js';
import { CatalogModule } from '../../catalog/index.js';
import { PricingFacade } from '../application/pricing.facade.js';
import { PricingQueries } from '../application/pricing.queries.js';
import { VariantPrices } from '../application/variant-prices.use-case.js';
import type { PriceListId } from '../domain/price-list.js';
import {
  type PricePeriodId,
  PricePeriodConflictError,
  type VariantId,
} from '../domain/variant-price.js';
import { VariantPriceRepository } from '../domain/variant-price.repository.js';
import { PricingModule } from '../pricing.module.js';

/** The list the migration creates (ADR-0125). */
const DEFAULT_LIST = '01a0f4f2-bb5f-770a-a269-105d21861fe0' as PriceListId;
const MIGRATION = path.join(
  process.cwd(),
  'prisma',
  'migrations',
  '20260930180000_pricing_default_list',
  'migration.sql',
);

const HOUR = 3_600_000;
const mxn = (amount: number) => Money.of(amount, 'MXN');

/** Prices of variants against PostgreSQL 18 (T-145 part a, ADR-0125). */
describe('Prices (T-145 part a)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cls: ClsService;
  let prices: VariantPrices;
  // A clock that moves forward a millisecond on each reading, so changes in a row never share an instant.
  let current: number;
  const clock = {
    now: () => {
      current += 1;
      return new Date(current);
    },
  };
  /** Some time after the last reading of the clock. */
  const later = (hours: number) => new Date(current + hours * HOUR);
  const staffId = newId<'User'>();

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
        AppCacheModule,
        AuditModule,
        CatalogModule,
        PricingModule,
      ],
    })
      .overrideProvider(Clock)
      .useValue(clock)
      .compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    cls = moduleRef.get(ClsService);
    prices = moduleRef.get(VariantPrices);
  });

  beforeEach(() => {
    current = Date.parse('2026-10-01T12:00:00.000Z');
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await prisma.pricePeriod.deleteMany();
    await prisma.variantPrice.deleteMany();
    await prisma.productVariant.deleteMany();
    await prisma.product.deleteMany();
    await prisma.auditLog.deleteMany({
      where: { action: { startsWith: 'prices.' } },
    });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { action: { startsWith: 'products.' } },
    });
    await moduleRef.close();
  });

  /** A variant of a new product, straight in the Catalog tables. */
  async function createVariant(): Promise<VariantId> {
    const productId = newId();
    const variantId = newId<'Variant'>();
    await prisma.product.create({
      data: {
        id: productId,
        title: `Camisa ${productId}`,
        slug: `camisa-${productId}`,
        status: 'DRAFT',
        variants: {
          create: {
            id: variantId,
            sku: `SKU-${variantId}`.toUpperCase(),
            options: {},
            status: 'ACTIVE',
          },
        },
      },
    });
    return variantId;
  }

  const set = (
    variantId: VariantId,
    amount: number,
    effectiveFrom: Date | null = null,
    compareAtAmount: number | null = null,
  ) =>
    cls.run(() =>
      prices.set(
        DEFAULT_LIST,
        variantId,
        { amount, compareAtAmount, effectiveFrom },
        staffId,
      ),
    );

  const cancel = (variantId: VariantId, periodId: PricePeriodId) =>
    cls.run(() => prices.cancel(DEFAULT_LIST, variantId, periodId));

  /** The stored line of a variant, oldest first, as `amount from → to`. */
  async function line(variantId: VariantId): Promise<string[]> {
    const rows = await prisma.pricePeriod.findMany({
      where: { variantPrice: { variantId } },
      orderBy: { effectiveFrom: 'asc' },
    });
    return rows.map(
      ({ amount, effectiveFrom, effectiveTo }) =>
        `${amount} ${effectiveFrom.toISOString()} → ${effectiveTo?.toISOString() ?? '∞'}`,
    );
  }

  const audited = (action: string) =>
    prisma.auditLog.findMany({
      where: { action },
      select: { resourceType: true, resourceId: true, changes: true },
    });

  describe('the default list', () => {
    it('is the only list, created by the migration (ADR-0039, BR-PRC-06)', async () => {
      expect(await moduleRef.get(PricingQueries).listPriceLists()).toEqual([
        {
          id: DEFAULT_LIST,
          code: 'GENERAL',
          name: 'Lista general',
          currency: 'MXN',
          priority: 0,
          isDefault: true,
          taxesIncluded: true,
          status: 'ACTIVE',
        },
      ]);
    });

    it('is never added twice when the migration runs again', async () => {
      await prisma.$executeRawUnsafe(readFileSync(MIGRATION, 'utf8'));

      expect(await prisma.priceList.count()).toBe(1);
    });
  });

  describe('setting and scheduling prices', () => {
    it('opens and closes periods, audits each one and keeps the variant row up to date', async () => {
      const variantId = await createVariant();

      const first = await set(variantId, 59_900, null, 79_900);
      const sale = await set(variantId, 49_900, later(24));
      const second = await set(variantId, 54_900);

      expect(first.created && sale.created && second.created).toBe(true);
      expect(await line(variantId)).toEqual([
        `59900 ${first.period.effectiveFrom.toISOString()} → ${second.period.effectiveFrom.toISOString()}`,
        `54900 ${second.period.effectiveFrom.toISOString()} → ${sale.period.effectiveFrom.toISOString()}`,
        `49900 ${sale.period.effectiveFrom.toISOString()} → ∞`,
      ]);
      expect(first.period).toMatchObject({
        amount: mxn(59_900),
        compareAtAmount: mxn(79_900),
        state: 'CURRENT',
        createdBy: staffId,
      });
      expect(sale.period.state).toBe('SCHEDULED');
      const row = await prisma.variantPrice.findFirstOrThrow({
        where: { variantId },
      });
      expect(row).toMatchObject({ priceListId: DEFAULT_LIST, version: 4 });
      expect(await audited('prices.set')).toContainEqual({
        resourceType: 'price-period',
        resourceId: first.period.id,
        changes: {
          priceListId: { from: null, to: DEFAULT_LIST },
          variantId: { from: null, to: variantId },
          amount: { from: null, to: 59_900 },
          compareAtAmount: { from: null, to: 79_900 },
          effectiveFrom: {
            from: null,
            to: first.period.effectiveFrom.toISOString(),
          },
        },
      });
      expect(await audited('prices.schedule')).toEqual([
        expect.objectContaining({ resourceId: sale.period.id }),
      ]);
    });

    it('opens nothing for the same price as the current one', async () => {
      const variantId = await createVariant();
      const first = await set(variantId, 59_900);

      const again = await set(variantId, 59_900);

      expect(again).toEqual({ period: first.period, created: false });
      expect(await line(variantId)).toHaveLength(1);
      expect(
        await prisma.auditLog.count({
          where: { action: { startsWith: 'prices.' } },
        }),
      ).toBe(1);
    });

    it('rejects a period that begins with another one, and keeps the line', async () => {
      const variantId = await createVariant();
      await set(variantId, 59_900);
      const sale = await set(variantId, 49_900, later(24));
      const before = await line(variantId);

      await expect(
        set(variantId, 44_900, sale.period.effectiveFrom),
      ).rejects.toThrow(new PricePeriodConflictError('overlap'));

      expect(await line(variantId)).toEqual(before);
    });

    it('answers a missing variant or list as not found, and writes nothing', async () => {
      const variantId = await createVariant();

      await expect(set(newId<'Variant'>(), 59_900)).rejects.toThrow(
        NotFoundError,
      );
      await expect(
        cls.run(() =>
          prices.set(
            newId<'PriceList'>(),
            variantId,
            { amount: 59_900, compareAtAmount: null, effectiveFrom: null },
            staffId,
          ),
        ),
      ).rejects.toThrow(NotFoundError);

      expect(await prisma.variantPrice.count()).toBe(0);
    });

    it('turns an overlap the database rejects into a conflict (BR-PRC-01)', async () => {
      const variantId = await createVariant();
      const scheduled = await set(variantId, 59_900, later(10));
      const repository = moduleRef.get(VariantPriceRepository);
      const lock = repository.lock.bind(repository);
      const txHost =
        moduleRef.get<TransactionHost<PrismaTransactionAdapter>>(
          TransactionHost,
        );
      // Another period appears after the prices were read, as if a change had skipped the lock.
      jest
        .spyOn(repository, 'lock')
        .mockImplementationOnce(async (listId, id) => {
          const locked = await lock(listId, id);
          await txHost.tx.pricePeriod.create({
            data: {
              id: newId(),
              variantPriceId: locked.id,
              amount: 39_900,
              effectiveFrom: later(5),
              effectiveTo: later(6),
              createdBy: staffId,
            },
          });
          return locked;
        });

      await expect(set(variantId, 49_900, later(5.5))).rejects.toThrow(
        new PricePeriodConflictError('overlap'),
      );

      expect(await line(variantId)).toEqual([
        `59900 ${scheduled.period.effectiveFrom.toISOString()} → ∞`,
      ]);
    });
  });

  describe('cancelling a scheduled price', () => {
    it('gives its time back to the period before it, and audits it', async () => {
      const variantId = await createVariant();
      const first = await set(variantId, 59_900);
      const sale = await set(variantId, 49_900, later(24));
      const back = await set(variantId, 59_900, later(48));

      await cancel(variantId, sale.period.id);

      expect(await line(variantId)).toEqual([
        `59900 ${first.period.effectiveFrom.toISOString()} → ${back.period.effectiveFrom.toISOString()}`,
        `59900 ${back.period.effectiveFrom.toISOString()} → ∞`,
      ]);
      expect(await audited('prices.cancel')).toEqual([
        {
          resourceType: 'price-period',
          resourceId: sale.period.id,
          changes: {
            priceListId: { from: DEFAULT_LIST, to: null },
            variantId: { from: variantId, to: null },
            amount: { from: 49_900, to: null },
            effectiveFrom: {
              from: sale.period.effectiveFrom.toISOString(),
              to: null,
            },
          },
        },
      ]);
    });

    it('rejects a period that already began (BR-PRC-04), and one of another variant', async () => {
      const variantId = await createVariant();
      const other = await createVariant();
      const first = await set(variantId, 59_900);
      const sale = await set(variantId, 49_900, later(24));

      await expect(cancel(variantId, first.period.id)).rejects.toThrow(
        new PricePeriodConflictError('already-started'),
      );
      await expect(cancel(other, sale.period.id)).rejects.toThrow(
        NotFoundError,
      );
      expect(await line(variantId)).toHaveLength(2);
      expect(
        await prisma.variantPrice.count({ where: { variantId: other } }),
      ).toBe(0);
    });
  });

  describe('reading prices', () => {
    it('lists the periods, the latest start first, with their state and the one in force', async () => {
      const variantId = await createVariant();
      const first = await set(variantId, 59_900);
      const second = await set(variantId, 54_900);
      const sale = await set(variantId, 49_900, later(24));

      const all = await prices.history(DEFAULT_LIST, variantId);
      const upcoming = await prices.history(DEFAULT_LIST, variantId, [
        'SCHEDULED',
      ]);

      expect(all.periods.map(({ id, state }) => [id, state])).toEqual([
        [sale.period.id, 'SCHEDULED'],
        [second.period.id, 'CURRENT'],
        [first.period.id, 'PAST'],
      ]);
      expect(all.current?.id).toBe(second.period.id);
      expect(upcoming.periods.map(({ id }) => id)).toEqual([sale.period.id]);
      expect(upcoming.current?.id).toBe(second.period.id);
      await expect(
        prices.history(DEFAULT_LIST, newId<'Variant'>()),
      ).rejects.toThrow(NotFoundError);
    });

    it('quotes the price in force at any instant, with no job for scheduled prices (UC-PRC-06)', async () => {
      const shirt = await createVariant();
      const cap = await createVariant();
      const unpriced = await createVariant();
      const first = await set(shirt, 59_900, null, 79_900);
      const sale = await set(shirt, 49_900, later(24));
      await set(cap, 19_900);
      const facade = moduleRef.get(PricingFacade);

      const now = await facade.quote([shirt, cap, unpriced], later(1));
      const duringSale = await facade.quote([shirt], sale.period.effectiveFrom);
      const before = await facade.quote(
        [shirt],
        new Date(first.period.effectiveFrom.getTime() - 1),
      );

      expect(now).toEqual(
        new Map([
          [
            shirt,
            {
              variantId: shirt,
              amount: mxn(59_900),
              compareAtAmount: mxn(79_900),
            },
          ],
          [cap, { variantId: cap, amount: mxn(19_900), compareAtAmount: null }],
        ]),
      );
      expect(duringSale.get(shirt)?.amount).toEqual(mxn(49_900));
      // At the instant the sale begins, only the sale is in force: the period before it ends there.
      expect(
        await moduleRef
          .get(PricingQueries)
          .currentPrices(DEFAULT_LIST, [shirt], sale.period.effectiveFrom),
      ).toEqual([
        { variantId: shirt, amount: mxn(49_900), compareAtAmount: null },
      ]);
      expect(before.size).toBe(0);
    });
  });

  describe('changes at the same time', () => {
    /** A connection outside the application, to hold rows the changes need. */
    async function holder(): Promise<pg.Client> {
      const client = new pg.Client({
        connectionString: process.env.DATABASE_URL,
      });
      await client.connect();
      await client.query('BEGIN');
      return client;
    }

    it('runs two price changes of one variant one after the other', async () => {
      const variantId = await createVariant();
      const first = await set(variantId, 59_900);
      // Hold the current period, which both changes close, so both are under way when it is released.
      const client = await holder();
      await client.query(
        'SELECT id FROM price_periods WHERE id = $1 FOR UPDATE',
        [first.period.id],
      );

      const results = Promise.all([
        set(variantId, 49_900),
        set(variantId, 44_900),
      ]);
      await waitForLockWaiters(2);
      await client.query('COMMIT');
      await client.end();
      const [a, b] = await results;

      const [earlier, last] =
        a.period.effectiveFrom < b.period.effectiveFrom ? [a, b] : [b, a];
      expect(await line(variantId)).toEqual([
        `59900 ${first.period.effectiveFrom.toISOString()} → ${earlier.period.effectiveFrom.toISOString()}`,
        `${earlier.period.amount.amount} ${earlier.period.effectiveFrom.toISOString()} → ${last.period.effectiveFrom.toISOString()}`,
        `${last.period.amount.amount} ${last.period.effectiveFrom.toISOString()} → ∞`,
      ]);
    });

    it('creates the row of a variant once for two first prices at the same time', async () => {
      const variantId = await createVariant();
      // Hold the list, which both new rows reference, so both inserts are under way when it is released.
      const client = await holder();
      await client.query(
        'SELECT id FROM price_lists WHERE id = $1 FOR UPDATE',
        [DEFAULT_LIST],
      );

      const results = Promise.all([
        set(variantId, 49_900),
        set(variantId, 44_900),
      ]);
      await waitForLockWaiters(2);
      await client.query('COMMIT');
      await client.end();
      await results;

      expect(await prisma.variantPrice.count({ where: { variantId } })).toBe(1);
      expect(await line(variantId)).toHaveLength(2);
    });
  });
});
