import { createHash } from 'node:crypto';
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
import { Clock, newId } from '../../../shared-kernel/index.js';
import { AuditModule } from '../../audit/index.js';
import { ImportReceipts } from '../application/import-receipts.use-case.js';
import {
  MAX_RECEIPT_IMPORT_ROWS,
  ReceiptImportError,
  type ReceiptImportRow,
} from '../application/receipt-import.js';
import { DuplicateReceiptFileError } from '../domain/receipt-import.repository.js';
import { InventoryModule } from '../inventory.module.js';

/** The clock of the API, which writes the dates of the movements, not the one of PostgreSQL (ADR-0124). */
const NOW = new Date('2026-10-15T12:00:00.000Z');
const STAFF = newId<'User'>();
/** The error of a file imported at `NOW`. */
const IMPORTED_NOW = {
  code: 'duplicate-value',
  details: { field: 'file', importedAt: NOW.toISOString() },
};

/** Rows from line 2, as the file reader gives them. */
const rows = (
  ...cells: [string, string, string, string?][]
): ReceiptImportRow[] =>
  cells.map(([sku, warehouse, quantity, note = ''], index) => ({
    line: index + 2,
    wellFormed: true,
    sku,
    warehouse,
    quantity,
    note,
  }));

/** A file with these rows: its SHA-256 depends on `name`, so two files with the same rows can differ. */
const fileOf = (name: string, fileRows: readonly ReceiptImportRow[]) => ({
  rows: fileRows,
  sha256: createHash('sha256').update(name).digest('hex'),
});

/** Bulk import of receipts against PostgreSQL 18 (T-146 part b, UC-INV-12, ADR-0164). */
describe('Bulk import of receipts (T-146 part b)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cls: ClsService;
  let principal: string;

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
        InventoryModule,
      ],
    })
      .overrideProvider(Clock)
      .useValue({ now: () => NOW })
      .compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    cls = moduleRef.get(ClsService);
    // The warehouse the migration creates (ADR-0127).
    ({ id: principal } = await prisma.warehouse.findUniqueOrThrow({
      where: { code: 'PRINCIPAL' },
    }));
  });

  afterEach(async () => {
    await prisma.stockMovement.deleteMany();
    await prisma.stockItem.deleteMany();
    await prisma.stockReceiptImport.deleteMany();
    await prisma.warehouse.deleteMany({
      where: { code: { not: 'PRINCIPAL' } },
    });
    await prisma.productVariant.deleteMany();
    await prisma.product.deleteMany();
    await prisma.auditLog.deleteMany({
      where: { action: 'inventory.receipt-import' },
    });
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  /** Variants of a new product with these SKUs, straight in the Catalog tables, and their IDs. */
  async function createVariants(...skus: string[]): Promise<string[]> {
    const productId = newId();
    const ids = skus.map(() => newId());
    await prisma.product.create({
      data: {
        id: productId,
        title: 'Camisa',
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

  async function createWarehouse(code: string): Promise<string> {
    const id = newId();
    await prisma.warehouse.create({
      data: {
        id,
        code,
        name: code,
        status: 'ACTIVE',
        priority: 2,
        updatedAt: NOW,
      },
    });
    return id;
  }

  /** An item of stock with these units, as an earlier receipt left it. */
  async function stockOf(
    variantId: string,
    warehouseId: string,
    onHand: number,
  ): Promise<string> {
    const id = newId();
    await prisma.stockItem.create({
      data: { id, variantId, warehouseId, onHand, reserved: 0, updatedAt: NOW },
    });
    await prisma.stockMovement.create({
      data: {
        id: newId(),
        stockItemId: id,
        type: 'RECEIPT',
        quantity: onHand,
        onHandAfter: onHand,
        createdAt: NOW,
      },
    });
    return id;
  }

  const importFile = (file: ReturnType<typeof fileOf>, dryRun = false) =>
    cls.run(() =>
      moduleRef.get(ImportReceipts).execute(file, { dryRun }, STAFF),
    );

  const counts = async () => ({
    items: await prisma.stockItem.count(),
    movements: await prisma.stockMovement.count(),
    imports: await prisma.stockReceiptImport.count(),
    audits: await prisma.auditLog.count({
      where: { action: 'inventory.receipt-import' },
    }),
  });

  it('adds each row to its stock item, creating it on the first receipt, records the file and audits the import once', async () => {
    const [shirt, cap] = await createVariants('CAM-LINO-M', 'GORRA-AZUL');
    const store = await createWarehouse('TIENDA');
    const existing = await stockOf(shirt, principal, 10);
    const file = fileOf(
      'llegada-1',
      rows(
        ['cam-lino-m', 'principal', '25', 'Remisión 1234'],
        ['GORRA-AZUL', 'TIENDA', '4'],
        ['CAM-LINO-M', 'PRINCIPAL', '1'],
      ),
    );

    const summary = await importFile(file);

    expect(summary).toEqual({ rows: 3, units: 30, dryRun: false });
    const items = await prisma.stockItem.findMany({
      include: {
        movements: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      },
      orderBy: { onHand: 'asc' },
    });
    expect(items).toEqual([
      expect.objectContaining({
        variantId: cap,
        warehouseId: store,
        onHand: 4,
        reserved: 0,
        createdAt: NOW,
        updatedAt: NOW,
        movements: [
          expect.objectContaining({
            type: 'RECEIPT',
            quantity: 4,
            onHandAfter: 4,
            reasonCode: null,
            note: null,
            actorId: STAFF,
            createdAt: NOW,
          }),
        ],
      }),
      expect.objectContaining({
        id: existing,
        onHand: 36,
        updatedAt: NOW,
        movements: [
          expect.objectContaining({ quantity: 10, onHandAfter: 10 }),
          expect.objectContaining({
            type: 'RECEIPT',
            quantity: 25,
            onHandAfter: 35,
            note: 'Remisión 1234',
            actorId: STAFF,
            createdAt: NOW,
          }),
          expect.objectContaining({ quantity: 1, onHandAfter: 36 }),
        ],
      }),
    ]);
    // Every change of onHand has its movement (BR-INV-13).
    for (const { onHand, movements } of items) {
      expect(movements.reduce((sum, { quantity }) => sum + quantity, 0)).toBe(
        onHand,
      );
    }
    expect(await prisma.stockReceiptImport.findMany()).toEqual([
      {
        id: expect.any(String),
        fileSha256: file.sha256,
        rows: 3,
        units: 30,
        createdBy: STAFF,
        createdAt: NOW,
      },
    ]);
    expect(
      await prisma.auditLog.findMany({
        where: { action: 'inventory.receipt-import' },
      }),
    ).toEqual([
      expect.objectContaining({
        resourceType: 'stock-receipt-import',
        result: 'SUCCESS',
        changes: {
          rows: { from: null, to: 3 },
          units: { from: null, to: 30 },
          fileSha256: { from: null, to: file.sha256 },
        },
      }),
    ]);
  });

  it('with dryRun, runs the writes and rolls them back, the record of the file too', async () => {
    await createVariants('CAM-LINO-M');
    const file = fileOf('prueba', rows(['CAM-LINO-M', 'PRINCIPAL', '25']));

    expect(await importFile(file, true)).toEqual({
      rows: 1,
      units: 25,
      dryRun: true,
    });
    expect(await counts()).toEqual({
      items: 0,
      movements: 0,
      imports: 0,
      audits: 0,
    });
    // So it can be imported afterwards.
    expect(await importFile(file)).toMatchObject({ dryRun: false });
  });

  it('refuses a file already imported, saying when, and takes another one with the same rows', async () => {
    await createVariants('CAM-LINO-M');
    const fileRows = rows(['CAM-LINO-M', 'PRINCIPAL', '25']);
    await importFile(fileOf('remision-1', fileRows));

    await expect(
      importFile(fileOf('remision-1', fileRows)),
    ).rejects.toMatchObject(IMPORTED_NOW);
    await expect(
      importFile(fileOf('remision-1', fileRows), true),
    ).rejects.toMatchObject(IMPORTED_NOW);
    expect((await prisma.stockItem.findFirstOrThrow()).onHand).toBe(25);

    await importFile(fileOf('remision-2', fileRows));
    expect((await prisma.stockItem.findFirstOrThrow()).onHand).toBe(50);
  });

  it('imports the same file sent twice at the same time only once', async () => {
    await createVariants('CAM-LINO-M');
    const file = fileOf('doble', rows(['CAM-LINO-M', 'PRINCIPAL', '25']));

    const results = await Promise.allSettled([
      importFile(file),
      importFile(file),
    ]);

    expect(results.map(({ status }) => status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    const rejected = results.find(({ status }) => status === 'rejected');
    expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(
      DuplicateReceiptFileError,
    );
    expect((rejected as PromiseRejectedResult).reason).toMatchObject(
      IMPORTED_NOW,
    );
    expect(await counts()).toMatchObject({
      items: 1,
      movements: 1,
      imports: 1,
    });
    expect((await prisma.stockItem.findFirstOrThrow()).onHand).toBe(25);
  });

  it('answers a warehouse deactivated while the import waits for it, and saves nothing', async () => {
    await createVariants('CAM-LINO-M');
    const store = await createWarehouse('TIENDA');
    // A deactivation under way: it holds the warehouse and has not committed.
    const holder = new pg.Client({
      connectionString: process.env.DATABASE_URL,
    });
    await holder.connect();
    await holder.query('BEGIN');
    await holder.query(
      "UPDATE warehouses SET status = 'INACTIVE' WHERE id = $1",
      [store],
    );

    const result = importFile(
      fileOf('tienda', rows(['CAM-LINO-M', 'TIENDA', '5'])),
    ).catch((error: unknown) => error);
    await waitForLockWaiters(1);
    await holder.query('COMMIT');
    await holder.end();

    const error = await result;
    expect(error).toBeInstanceOf(ReceiptImportError);
    expect((error as ReceiptImportError).details?.errors).toEqual([
      expect.objectContaining({
        field: 'rows[2].warehouse',
        code: 'inactiveWarehouse',
      }),
    ]);
    expect(await counts()).toEqual({
      items: 0,
      movements: 0,
      imports: 0,
      audits: 0,
    });
  });

  it('adds to the units another change left while the import waited for the stock item', async () => {
    const [shirt] = await createVariants('CAM-LINO-M');
    const item = await stockOf(shirt, principal, 10);
    // A sale or an adjustment under way locks the stock item; locking it without changing it yet lets the import
    // go past creating the missing stock items, so it waits on the lock of the item itself.
    const holder = new pg.Client({
      connectionString: process.env.DATABASE_URL,
    });
    await holder.connect();
    await holder.query('BEGIN');
    await holder.query('SELECT id FROM stock_items WHERE id = $1 FOR UPDATE', [
      item,
    ]);

    const result = importFile(
      fileOf('espera', rows(['CAM-LINO-M', 'PRINCIPAL', '1'])),
    );
    await waitForLockWaiters(1);
    // The change ends while the import waits: the import adds to it instead of overwriting it.
    await holder.query(
      'UPDATE stock_items SET on_hand = on_hand + 5 WHERE id = $1',
      [item],
    );
    await holder.query('COMMIT');
    await holder.end();
    await result;

    expect(
      await prisma.stockItem.findUniqueOrThrow({ where: { id: item } }),
    ).toMatchObject({ onHand: 16 });
    expect(
      await prisma.stockMovement.findFirstOrThrow({
        where: { stockItemId: item, quantity: 1 },
      }),
    ).toMatchObject({ onHandAfter: 16 });
  });

  it(`imports ${MAX_RECEIPT_IMPORT_ROWS} rows within the time limit of a transaction`, async () => {
    const skus = Array.from(
      { length: MAX_RECEIPT_IMPORT_ROWS },
      (_, index) => `SKU-${String(index).padStart(5, '0')}`,
    );
    await createVariants(...skus);

    const summary = await importFile(
      fileOf(
        'grande',
        rows(
          ...skus.map((sku): [string, string, string, string] => [
            sku,
            'PRINCIPAL',
            '100000',
            'Inventario inicial',
          ]),
        ),
      ),
    );

    expect(summary.units).toBe(MAX_RECEIPT_IMPORT_ROWS * 100_000);
    expect(await counts()).toEqual({
      items: MAX_RECEIPT_IMPORT_ROWS,
      movements: MAX_RECEIPT_IMPORT_ROWS,
      imports: 1,
      audits: 1,
    });
  }, 120_000);
});
