import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import pg from 'pg';
import { waitForLockWaiters } from '../../../../test/support/lock-waiters.js';
import { AppCacheModule } from '../../../platform/cache/app-cache.module.js';
import { ClockModule } from '../../../platform/clock/clock.module.js';
import { validateEnvironment } from '../../../platform/config/environment.js';
import { EventsModule } from '../../../platform/events/events.module.js';
import { PersistenceModule } from '../../../platform/persistence/persistence.module.js';
import { PrismaService } from '../../../platform/persistence/prisma.service.js';
import { Clock, newId, NotFoundError } from '../../../shared-kernel/index.js';
import { AuditModule } from '../../audit/index.js';
import { CatalogModule } from '../../catalog/index.js';
import { ImportPrices } from '../application/import-prices.use-case.js';
import {
  MAX_PRICE_IMPORT_ROWS,
  PriceImportError,
  type PriceImportRow,
} from '../application/price-import.js';
import { VariantPrices } from '../application/variant-prices.use-case.js';
import type { PriceListId } from '../domain/price-list.js';
import type { VariantId } from '../domain/variant-price.js';
import { PricingModule } from '../pricing.module.js';

/** The list the migration creates (ADR-0125). */
const DEFAULT_LIST = '01a0f4f2-bb5f-770a-a269-105d21861fe0' as PriceListId;
const HOUR = 3_600_000;

/** Bulk import of prices against PostgreSQL 18 (T-145 part b, UC-PRC-05, ADR-0126). */
describe('Bulk import of prices (T-145 part b)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cls: ClsService;
  // A clock that moves forward a millisecond on each reading, so changes in a row never share an instant.
  let current: number;
  const clock = {
    now: () => {
      current += 1;
      return new Date(current);
    },
  };
  /** Some time after the last reading of the clock, as the file writes it. */
  const later = (hours: number) =>
    new Date(current + hours * HOUR).toISOString();
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
  });

  beforeEach(() => {
    current = Date.parse('2026-10-01T12:00:00.000Z');
  });

  afterEach(async () => {
    await prisma.pricePeriod.deleteMany();
    await prisma.variantPrice.deleteMany();
    await prisma.productVariant.deleteMany();
    await prisma.product.deleteMany();
    await prisma.auditLog.deleteMany({
      where: { action: { startsWith: 'prices.' } },
    });
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  /** Variants of a new product with these SKUs, straight in the Catalog tables. */
  async function createVariants(...skus: string[]): Promise<VariantId[]> {
    const productId = newId();
    const ids = skus.map(() => newId<'Variant'>());
    await prisma.product.create({
      data: {
        id: productId,
        title: `Camisa ${productId}`,
        slug: `camisa-${productId}`,
        status: 'DRAFT',
      },
    });
    await prisma.productVariant.createMany({
      data: skus.map((sku, index) => ({
        id: ids[index],
        productId,
        sku,
        options: { n: String(index) },
        status: 'ACTIVE' as const,
      })),
    });
    return ids;
  }

  /** Rows from line 2, as the file reader gives them. */
  const rows = (
    ...cells: [string, string, string?, string?][]
  ): PriceImportRow[] =>
    cells.map(
      ([sku, amount, compareAtAmount = '', effectiveFrom = ''], index) => ({
        line: index + 2,
        wellFormed: true,
        sku,
        amount,
        compareAtAmount,
        effectiveFrom,
      }),
    );

  const importRows = (fileRows: readonly PriceImportRow[], dryRun = false) =>
    cls.run(() =>
      moduleRef
        .get(ImportPrices)
        .execute(DEFAULT_LIST, fileRows, { dryRun }, staffId),
    );

  /** The rejected import's errors. */
  async function errorsOf(fileRows: readonly PriceImportRow[]) {
    const error = await importRows(fileRows).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(PriceImportError);
    return (error as PriceImportError).details?.errors;
  }

  /** The stored line of a variant, oldest first, as `amount compareAt from → to`. */
  async function line(variantId: VariantId): Promise<string[]> {
    const periods = await prisma.pricePeriod.findMany({
      where: { variantPrice: { variantId } },
      orderBy: { effectiveFrom: 'asc' },
    });
    return periods.map(
      ({ amount, compareAtAmount, effectiveFrom, effectiveTo }) =>
        `${amount} ${compareAtAmount ?? '-'} ${effectiveFrom.toISOString()} → ${effectiveTo?.toISOString() ?? '∞'}`,
    );
  }

  const audited = () =>
    prisma.auditLog.findMany({
      where: { action: { startsWith: 'prices.' } },
      select: {
        action: true,
        resourceType: true,
        resourceId: true,
        changes: true,
      },
    });

  it('applies every row, and audits the import once with its counts', async () => {
    const [shirt, cap] = await createVariants('CAM-LINO-M', 'GORRA-AZUL');
    const sale = later(24);
    const back = later(48);

    const summary = await importRows(
      rows(
        ['CAM-LINO-M', '499.00', '799', sale],
        ['cam-lino-m', '599.00', '799.00'],
        ['CAM-LINO-M', '599', '', back],
        ['gorra-azul', '199.5'],
      ),
    );

    expect(summary).toEqual({
      rows: 4,
      created: 4,
      unchanged: 0,
      dryRun: false,
    });
    const [first] = await prisma.pricePeriod.findMany({
      where: { variantPrice: { variantId: shirt } },
      orderBy: { effectiveFrom: 'asc' },
    });
    const now = first.effectiveFrom.toISOString();
    expect(await line(shirt)).toEqual([
      `59900 79900 ${now} → ${sale}`,
      `49900 79900 ${sale} → ${back}`,
      `59900 - ${back} → ∞`,
    ]);
    expect(await line(cap)).toEqual([`19950 - ${now} → ∞`]);
    expect(first.createdBy).toBe(staffId);
    expect(await audited()).toEqual([
      {
        action: 'prices.import',
        resourceType: 'price-list',
        resourceId: DEFAULT_LIST,
        changes: {
          rows: { from: null, to: 4 },
          created: { from: null, to: 4 },
          unchanged: { from: null, to: 0 },
        },
      },
    ]);
  });

  it('changes nothing, and audits nothing, when the same file comes again', async () => {
    const [shirt, cap] = await createVariants('CAM-LINO-M', 'GORRA-AZUL');
    const file = rows(
      ['CAM-LINO-M', '599'],
      ['CAM-LINO-M', '499', '', later(24)],
    );
    await importRows(file);
    const before = await line(shirt);

    const again = await importRows(file);

    expect(again).toEqual({
      rows: 2,
      created: 0,
      unchanged: 2,
      dryRun: false,
    });
    expect(await line(shirt)).toEqual(before);
    expect(await audited()).toHaveLength(1);
    expect(
      (
        await prisma.variantPrice.findFirstOrThrow({
          where: { variantId: shirt },
        })
      ).version,
    ).toBe(2);

    // A file that changes one variant leaves the row of the other one as it was.
    await importRows(rows(['CAM-LINO-M', '599'], ['GORRA-AZUL', '199']));
    const versions = await prisma.variantPrice.findMany({
      select: { variantId: true, version: true },
      orderBy: { variantId: 'asc' },
    });
    expect(versions).toEqual(
      expect.arrayContaining([
        { variantId: shirt, version: 2 },
        { variantId: cap, version: 2 },
      ]),
    );
  });

  it('answers what a dry run would do, and writes nothing', async () => {
    await createVariants('CAM-LINO-M', 'GORRA-AZUL');

    const summary = await importRows(
      rows(['CAM-LINO-M', '599'], ['GORRA-AZUL', '199']),
      true,
    );

    expect(summary).toEqual({
      rows: 2,
      created: 2,
      unchanged: 0,
      dryRun: true,
    });
    expect(await prisma.variantPrice.count()).toBe(0);
    expect(await prisma.pricePeriod.count()).toBe(0);
    expect(await audited()).toEqual([]);
  });

  it('imports nothing when any row fails, and lists the errors by line', async () => {
    await createVariants('CAM-LINO-M', 'GORRA-AZUL');
    const fileRows = rows(
      ['NO-EXISTE', '599'],
      ['CAM-LINO-M', '$599'],
      ['CAM-LINO-M', '599', '599', later(1)],
      ['CAM-LINO-M', '599', '', '14/11/2026'],
      ['GORRA-AZUL', ''],
      ['', '199'],
      ['GORRA-AZUL', '199'],
      ['gorra-azul', '149', '', '2026-01-01 00:00'],
      ['CAM-LINO-M', '599'],
      ['GORRA-AZUL', '149', '$199'],
    );
    const malformed = { ...fileRows[2], line: 12, wellFormed: false };

    expect(await errorsOf([...fileRows, malformed])).toEqual([
      expect.objectContaining({ field: 'rows[2].sku', code: 'unknownSku' }),
      expect.objectContaining({ field: 'rows[3].amount', code: 'pesos' }),
      expect.objectContaining({
        field: 'rows[4].compareAtAmount',
        code: 'compareAtAmount',
      }),
      expect.objectContaining({
        field: 'rows[5].effectiveFrom',
        code: 'dateTime',
      }),
      expect.objectContaining({ field: 'rows[6].amount', code: 'isNotEmpty' }),
      expect.objectContaining({ field: 'rows[7].sku', code: 'isNotEmpty' }),
      // A date in the past starts now, like the row before it.
      expect.objectContaining({
        field: 'rows[9].effectiveFrom',
        code: 'repeatedStart',
      }),
      expect.objectContaining({
        field: 'rows[11].compareAtAmount',
        code: 'pesos',
      }),
      expect.objectContaining({ field: 'rows[12]', code: 'columnCount' }),
    ]);
    expect(await prisma.variantPrice.count()).toBe(0);
    expect(await audited()).toEqual([]);
  });

  it('rejects a row that begins with another price of its variant, and imports none of the others', async () => {
    const [shirt, cap] = await createVariants('CAM-LINO-M', 'GORRA-AZUL');
    const sale = later(24);
    await cls.run(() =>
      moduleRef.get(VariantPrices).set(
        DEFAULT_LIST,
        shirt,
        {
          amount: 49_900,
          compareAtAmount: null,
          effectiveFrom: new Date(sale),
        },
        staffId,
      ),
    );
    const before = await line(shirt);

    expect(
      await errorsOf(
        rows(['GORRA-AZUL', '199'], ['CAM-LINO-M', '449', '', sale]),
      ),
    ).toEqual([
      expect.objectContaining({
        field: 'rows[3].effectiveFrom',
        code: 'overlap',
      }),
    ]);
    expect(await line(shirt)).toEqual(before);
    expect(await line(cap)).toEqual([]);
  });

  it(`imports ${MAX_PRICE_IMPORT_ROWS} rows within the time limit of a transaction`, async () => {
    const skus = Array.from(
      { length: MAX_PRICE_IMPORT_ROWS },
      (_, index) => `SKU-${String(index).padStart(5, '0')}`,
    );
    const [first] = await createVariants(...skus);

    const summary = await importRows(
      rows(
        ...skus.map((sku, index): [string, string] => [
          sku,
          `${100 + index}.99`,
        ]),
      ),
    );

    expect(summary.created).toBe(MAX_PRICE_IMPORT_ROWS);
    expect(await prisma.pricePeriod.count()).toBe(MAX_PRICE_IMPORT_ROWS);
    expect(await line(first)).toEqual([expect.stringMatching(/^10099 - /)]);
  }, 60_000);

  it('runs an import and a single price of the same variant one after the other', async () => {
    const [shirt] = await createVariants('CAM-LINO-M');
    await importRows(rows(['CAM-LINO-M', '599']));
    const [current] = await prisma.pricePeriod.findMany({
      where: { variantPrice: { variantId: shirt } },
    });
    // Hold the current period, which both changes close, so both are under way when it is released.
    const holder = new pg.Client({
      connectionString: process.env.DATABASE_URL,
    });
    await holder.connect();
    await holder.query('BEGIN');
    await holder.query(
      'SELECT id FROM price_periods WHERE id = $1 FOR UPDATE',
      [current.id],
    );

    const results = Promise.all([
      importRows(rows(['CAM-LINO-M', '499'])),
      cls.run(() =>
        moduleRef
          .get(VariantPrices)
          .set(
            DEFAULT_LIST,
            shirt,
            { amount: 44_900, compareAtAmount: null, effectiveFrom: null },
            staffId,
          ),
      ),
    ]);
    await waitForLockWaiters(2);
    await holder.query('COMMIT');
    await holder.end();
    await results;

    const periods = await prisma.pricePeriod.findMany({
      where: { variantPrice: { variantId: shirt } },
      orderBy: { effectiveFrom: 'asc' },
    });
    expect(periods).toHaveLength(3);
    expect(periods.map(({ effectiveTo }) => effectiveTo)).toEqual([
      periods[1].effectiveFrom,
      periods[2].effectiveFrom,
      null,
    ]);
  });

  it('answers a missing list as not found', async () => {
    await expect(
      cls.run(() =>
        moduleRef
          .get(ImportPrices)
          .execute(
            newId<'PriceList'>(),
            rows(['X', '1']),
            { dryRun: false },
            staffId,
          ),
      ),
    ).rejects.toThrow(NotFoundError);
  });
});
