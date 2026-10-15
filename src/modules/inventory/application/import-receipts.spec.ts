import {
  type AuditEntry,
  type AuditTrail,
  toId,
  type TransactionManager,
} from '../../../shared-kernel/index.js';
import {
  DuplicateReceiptFileError,
  type ReceiptImportRecord,
  ReceiptImportRepository,
} from '../domain/receipt-import.repository.js';
import type { StockLevel, VariantId } from '../domain/stock.js';
import {
  type ComputedReceipt,
  type StockKey,
  StockLedgerRepository,
} from '../domain/stock-ledger.repository.js';
import { Warehouse, type WarehouseId } from '../domain/warehouse.js';
import { WarehouseRepository } from '../domain/warehouse.repository.js';
import { CatalogVariants } from './catalog-variants.js';
import { ImportReceipts } from './import-receipts.use-case.js';
import { ReceiptImportError, type ReceiptImportRow } from './receipt-import.js';

const NOW = new Date('2026-10-15T18:00:00.000Z');
const BEFORE = new Date('2026-10-14T12:00:00.000Z');
const STAFF = '0199e0a1-0000-7000-8000-0000000000aa';
const SHA = 'a'.repeat(64);
const CAMISA = toId<'Variant'>('0199e0a1-0000-7000-8000-000000000001');
const GORRA = toId<'Variant'>('0199e0a1-0000-7000-8000-000000000002');
const PRINCIPAL = toId<'Warehouse'>('0199e0a1-0000-7000-8000-000000000011');
const TIENDA = toId<'Warehouse'>('0199e0a1-0000-7000-8000-000000000012');
const CERRADO = toId<'Warehouse'>('0199e0a1-0000-7000-8000-000000000013');

const warehouse = (
  id: WarehouseId,
  code: string,
  status: 'ACTIVE' | 'INACTIVE',
): Warehouse =>
  Warehouse.restore({
    id,
    code,
    name: code,
    address: null,
    status,
    priority: 1,
  });

class InMemoryWarehouses extends WarehouseRepository {
  /** What `lockManyForStock` finds, as another transaction may have changed it since the checks. */
  locked: readonly Warehouse[];

  constructor(readonly known: readonly Warehouse[]) {
    super();
    this.locked = known;
  }

  findByCodes(codes: readonly string[]): Promise<Warehouse[]> {
    return Promise.resolve(
      this.known.filter((stored) => codes.includes(stored.snapshot().code)),
    );
  }

  lockManyForStock(ids: readonly WarehouseId[]): Promise<Warehouse[]> {
    return Promise.resolve(this.locked.filter(({ id }) => ids.includes(id)));
  }

  find(): never {
    throw new Error('not used');
  }

  lockActive(): never {
    throw new Error('not used');
  }

  lockForStock(): never {
    throw new Error('not used');
  }

  reservedUnits(): never {
    throw new Error('not used');
  }

  insert(): never {
    throw new Error('not used');
  }

  save(): never {
    throw new Error('not used');
  }
}

class InMemoryLedger extends StockLedgerRepository {
  readonly lockedKeys: StockKey[][] = [];
  readonly written: { receipts: readonly ComputedReceipt[]; at: Date }[] = [];

  /** The units each stock item holds before the import, by `<variant>/<warehouse>`. */
  constructor(private readonly onHand: Record<string, number> = {}) {
    super();
  }

  lockItems(keys: readonly StockKey[], at: Date): Promise<StockLevel[]> {
    this.lockedKeys.push([...keys]);
    return Promise.resolve(
      keys.map(({ variantId, warehouseId }) => ({
        id: toId<'StockItem'>(
          `${variantId.slice(0, -4)}${warehouseId.slice(-4)}`,
        ),
        variantId,
        warehouseId,
        onHand: this.onHand[`${variantId}/${warehouseId}`] ?? 0,
        reserved: 0,
        updatedAt: at,
      })),
    );
  }

  writeReceipts(receipts: readonly ComputedReceipt[], at: Date): Promise<void> {
    this.written.push({ receipts, at });
    return Promise.resolve();
  }

  receive(): never {
    throw new Error('not used');
  }

  adjust(): never {
    throw new Error('not used');
  }

  restock(): never {
    throw new Error('not used');
  }

  originsOf(): never {
    throw new Error('not used');
  }

  restockedOf(): never {
    throw new Error('not used');
  }
}

class InMemoryImports extends ReceiptImportRepository {
  readonly inserted: ReceiptImportRecord[] = [];

  /** When the file was imported, as each lookup finds it in turn; `null` when not imported. */
  constructor(
    private readonly lookups: (Date | null)[] = [null],
    private readonly takenOnInsert = false,
  ) {
    super();
  }

  importedAt(): Promise<Date | null> {
    return Promise.resolve(this.lookups.shift() ?? null);
  }

  insert(record: ReceiptImportRecord): Promise<void> {
    if (this.takenOnInsert) {
      return Promise.reject(new DuplicateReceiptFileError(null));
    }
    this.inserted.push(record);
    return Promise.resolve();
  }
}

class FixedCatalog extends CatalogVariants {
  findBySkus(skus: readonly string[]): Promise<ReadonlyMap<string, VariantId>> {
    const known = new Map([
      ['CAM-LINO-M', CAMISA],
      ['GORRA-AZUL', GORRA],
    ]);
    return Promise.resolve(
      new Map(
        skus.flatMap((sku) => (known.has(sku) ? [[sku, known.get(sku)!]] : [])),
      ),
    );
  }

  exists(): never {
    throw new Error('not used');
  }

  labels(): never {
    throw new Error('not used');
  }

  search(): never {
    throw new Error('not used');
  }

  findBySku(): never {
    throw new Error('not used');
  }
}

/** A row of the file at `line`, with the cells given and every other one empty. */
const row = (
  line: number,
  cells: Partial<Omit<ReceiptImportRow, 'line'>>,
): ReceiptImportRow => ({
  wellFormed: true,
  sku: '',
  warehouse: '',
  quantity: '',
  note: '',
  ...cells,
  line,
});

const valid = (line: number, quantity = '1') =>
  row(line, { sku: 'CAM-LINO-M', warehouse: 'PRINCIPAL', quantity });

function setUp(
  options: {
    onHand?: Record<string, number>;
    lookups?: (Date | null)[];
    takenOnInsert?: boolean;
  } = {},
) {
  const ledger = new InMemoryLedger(options.onHand);
  const warehouses = new InMemoryWarehouses([
    warehouse(PRINCIPAL, 'PRINCIPAL', 'ACTIVE'),
    warehouse(TIENDA, 'TIENDA', 'ACTIVE'),
    warehouse(CERRADO, 'CERRADO', 'INACTIVE'),
  ]);
  const imports = new InMemoryImports(options.lookups, options.takenOnInsert);
  const audited: AuditEntry[] = [];
  const audit = {
    record: (entry: AuditEntry) => {
      audited.push(entry);
      return Promise.resolve();
    },
  } as unknown as AuditTrail;
  const inline = {
    run: <T>(work: () => Promise<T>) => work(),
  } as unknown as TransactionManager;
  return {
    importReceipts: new ImportReceipts(
      ledger,
      warehouses,
      imports,
      new FixedCatalog(),
      inline,
      audit,
      { now: () => NOW },
    ),
    ledger,
    warehouses,
    imports,
    audited,
  };
}

const importOf = (
  context: ReturnType<typeof setUp>,
  rows: readonly ReceiptImportRow[],
  dryRun = false,
) => context.importReceipts.execute({ rows, sha256: SHA }, { dryRun }, STAFF);

/** The errors of importing `rows`, which must fail and write nothing. */
async function fieldsOf(
  rows: readonly ReceiptImportRow[],
  options: Parameters<typeof setUp>[0] = {},
): Promise<string[]> {
  const context = setUp(options);
  const error: unknown = await importOf(context, rows).then(
    () => {
      throw new Error('The file was imported');
    },
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(ReceiptImportError);
  expect([context.ledger.written, context.audited]).toEqual([[], []]);
  return (
    (error as ReceiptImportError).details?.errors as {
      field: string;
      code: string;
    }[]
  ).map(({ field, code }) => `${field} ${code}`);
}

describe('ImportReceipts (UC-INV-12, ADR-0164)', () => {
  it('adds each row to its stock item in the order of the file, records the file and audits the import once', async () => {
    const context = setUp({ onHand: { [`${CAMISA}/${PRINCIPAL}`]: 10 } });

    const summary = await importOf(context, [
      row(2, {
        sku: 'cam-lino-m',
        warehouse: 'principal',
        quantity: '25',
        note: 'Remisión 1234',
      }),
      row(3, { sku: 'GORRA-AZUL', warehouse: 'TIENDA', quantity: '100000' }),
      row(4, { sku: 'CAM-LINO-M', warehouse: 'PRINCIPAL', quantity: '1' }),
      // The same variant in another warehouse has another stock item.
      row(5, { sku: 'CAM-LINO-M', warehouse: 'TIENDA', quantity: '2' }),
    ]);

    expect(summary).toEqual({ rows: 4, units: 100_028, dryRun: false });
    expect(context.ledger.lockedKeys).toEqual([
      [
        { variantId: CAMISA, warehouseId: PRINCIPAL },
        { variantId: GORRA, warehouseId: TIENDA },
        { variantId: CAMISA, warehouseId: TIENDA },
      ],
    ]);
    const [{ receipts, at }] = context.ledger.written;
    expect(at).toEqual(NOW);
    expect(
      receipts.map(({ quantity, onHandAfter, note, actorId }) => ({
        quantity,
        onHandAfter,
        note,
        actorId,
      })),
    ).toEqual([
      { quantity: 25, onHandAfter: 35, note: 'Remisión 1234', actorId: STAFF },
      { quantity: 100_000, onHandAfter: 100_000, note: null, actorId: STAFF },
      { quantity: 1, onHandAfter: 36, note: null, actorId: STAFF },
      { quantity: 2, onHandAfter: 2, note: null, actorId: STAFF },
    ]);
    expect(receipts[0].stockItemId).toBe(receipts[2].stockItemId);
    expect(receipts[3].stockItemId).not.toBe(receipts[0].stockItemId);
    expect(new Set(receipts.map(({ movementId }) => movementId)).size).toBe(4);
    expect(context.imports.inserted).toEqual([
      {
        id: expect.any(String),
        fileSha256: SHA,
        rows: 4,
        units: 100_028,
        createdBy: STAFF,
        createdAt: NOW,
      },
    ]);
    expect(context.audited).toEqual([
      {
        action: 'inventory.receipt-import',
        resource: {
          type: 'stock-receipt-import',
          id: context.imports.inserted[0].id,
        },
        changes: {
          rows: { from: null, to: 4 },
          units: { from: null, to: 100_028 },
          fileSha256: { from: null, to: SHA },
        },
      },
    ]);
  });

  it('with dryRun, answers what it would do and audits nothing', async () => {
    const context = setUp();

    await expect(importOf(context, [valid(2, '5')], true)).resolves.toEqual({
      rows: 1,
      units: 5,
      dryRun: true,
    });
    expect(context.audited).toEqual([]);
  });

  it('refuses a file already imported before checking its rows, saying when', async () => {
    const context = setUp({ lookups: [BEFORE] });

    const error = await importOf(context, [row(2, {})]).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toEqual(new DuplicateReceiptFileError(BEFORE));
    expect(error).toMatchObject({
      code: 'duplicate-value',
      category: 'conflict',
      details: { field: 'file', importedAt: BEFORE.toISOString() },
    });
    expect([context.imports.inserted, context.ledger.written]).toEqual([
      [],
      [],
    ]);
  });

  it('refuses the same file imported at the same time by another import that commits first, saying when', async () => {
    const context = setUp({ lookups: [null, BEFORE], takenOnInsert: true });

    await expect(importOf(context, [valid(2)])).rejects.toMatchObject({
      code: 'duplicate-value',
      details: { field: 'file', importedAt: BEFORE.toISOString() },
    });
    expect(context.ledger.written).toEqual([]);
  });

  it.each([
    ['sku', { sku: '' }, 'isNotEmpty'],
    ['warehouse', { warehouse: '' }, 'isNotEmpty'],
    ['quantity', { quantity: '' }, 'isNotEmpty'],
    ['quantity', { quantity: '0' }, 'quantity'],
    ['quantity', { quantity: '100001' }, 'quantity'],
    ['quantity', { quantity: '2.5' }, 'quantity'],
    ['quantity', { quantity: '-3' }, 'quantity'],
    ['quantity', { quantity: '1000000' }, 'quantity'],
    ['note', { note: 'a'.repeat(501) }, 'maxLength'],
    ['sku', { sku: 'NO-EXISTE' }, 'unknownSku'],
    ['warehouse', { warehouse: 'OTRO' }, 'unknownWarehouse'],
    ['warehouse', { warehouse: 'cerrado' }, 'inactiveWarehouse'],
  ])('answers an invalid %s with %p as %s', async (column, cells, code) => {
    expect(
      await fieldsOf([
        row(2, {
          sku: 'CAM-LINO-M',
          warehouse: 'PRINCIPAL',
          quantity: '1',
          ...cells,
        }),
      ]),
    ).toEqual([`rows[2].${column} ${code}`]);
  });

  it('takes a note of 500 characters', async () => {
    const context = setUp();

    await importOf(context, [
      row(2, {
        sku: 'CAM-LINO-M',
        warehouse: 'PRINCIPAL',
        quantity: '1',
        note: 'a'.repeat(500),
      }),
    ]);

    expect(context.ledger.written[0].receipts[0].note).toHaveLength(500);
  });

  it('answers a row with another number of cells as an error of the whole row', async () => {
    expect(await fieldsOf([{ ...valid(2), wellFormed: false }])).toEqual([
      'rows[2] columnCount',
    ]);
  });

  it('answers a warehouse deactivated after the checks in each of its rows', async () => {
    const context = setUp();
    context.warehouses.locked = [warehouse(PRINCIPAL, 'PRINCIPAL', 'INACTIVE')];

    const error = await importOf(context, [
      valid(2),
      row(3, { sku: 'GORRA-AZUL', warehouse: 'TIENDA', quantity: '1' }),
    ]).catch((thrown: unknown) => thrown);

    expect((error as ReceiptImportError).details?.errors).toEqual([
      expect.objectContaining({
        field: 'rows[2].warehouse',
        code: 'inactiveWarehouse',
      }),
      expect.objectContaining({
        field: 'rows[3].warehouse',
        code: 'inactiveWarehouse',
      }),
    ]);
    expect(context.ledger.written).toEqual([]);
  });

  it('answers the rows that would take a stock item over the most it holds', async () => {
    expect(
      await fieldsOf([valid(2, '7'), valid(3, '1'), valid(4, '1')], {
        onHand: { [`${CAMISA}/${PRINCIPAL}`]: 2_147_483_640 },
      }),
    ).toEqual(['rows[3].quantity onHandLimit', 'rows[4].quantity onHandLimit']);
  });

  it('answers every error of the file, sorted by line, and records nothing', async () => {
    const context = setUp();
    const error = await importOf(context, [
      row(2, { sku: 'NO-EXISTE', warehouse: 'OTRO', quantity: 'x' }),
      valid(3),
      row(4, { sku: '', warehouse: 'PRINCIPAL', quantity: '1' }),
    ]).catch((thrown: unknown) => thrown);

    expect(
      (
        (error as ReceiptImportError).details?.errors as {
          field: string;
          code: string;
        }[]
      ).map(({ field, code }) => `${field} ${code}`),
    ).toEqual([
      'rows[2].quantity quantity',
      'rows[2].sku unknownSku',
      'rows[2].warehouse unknownWarehouse',
      'rows[4].sku isNotEmpty',
    ]);
    expect([context.imports.inserted, context.ledger.written]).toEqual([
      [],
      [],
    ]);
  });
});
