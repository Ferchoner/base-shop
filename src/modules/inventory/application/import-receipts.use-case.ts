import { Injectable } from '@nestjs/common';
import {
  AuditTrail,
  changesBetween,
  Clock,
  newId,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import {
  DuplicateReceiptFileError,
  ReceiptImportRepository,
} from '../domain/receipt-import.repository.js';
import { MAX_NOTE_LENGTH, noteOf, type VariantId } from '../domain/stock.js';
import {
  type ComputedReceipt,
  StockLedgerRepository,
} from '../domain/stock-ledger.repository.js';
import type { Warehouse, WarehouseId } from '../domain/warehouse.js';
import { WarehouseRepository } from '../domain/warehouse.repository.js';
import { CatalogVariants } from './catalog-variants.js';
import {
  MAX_ON_HAND,
  type ReceiptFile,
  type ReceiptImportRow,
  type ReceiptImportSummary,
  ReceiptRowErrors,
  unitsFrom,
} from './receipt-import.js';

/** The values of a row, each `undefined` when its cell is invalid. */
interface RowValues {
  readonly line: number;
  /** In uppercase, as SKUs are stored (BR-PRD-09). */
  readonly sku: string | undefined;
  /** In uppercase, as codes of warehouses are. */
  readonly warehouse: string | undefined;
  readonly quantity: number | undefined;
  readonly note: string | null | undefined;
}

/** A row whose values are all valid, with its variant and warehouse. */
interface Receipt {
  readonly line: number;
  readonly variantId: VariantId;
  readonly warehouseId: WarehouseId;
  readonly quantity: number;
  readonly note: string | null;
}

const REQUIRED = 'Es obligatorio.';
const INACTIVE = 'El almacén está inactivo: no recibe mercancía.';

/** Ends the import of a dry run after every write, so its transaction rolls back. */
class DryRunFinished extends Error {}

/**
 * Bulk import of receipts (UC-INV-12, ADR-0164): each row is a receipt of `POST …/receipts` (UC-INV-02), by the SKU
 * of the variant and the code of an active warehouse, all or nothing. A file already imported is refused, so its
 * units are not added twice. Every row is checked first; with any error, nothing is imported and the answer lists
 * the errors by line. Otherwise one transaction records the file, locks its warehouses and stock items, and writes
 * every movement with a few statements; the import is audited once. With `dryRun`, the same checks and writes run
 * and the transaction rolls back.
 */
@Injectable()
export class ImportReceipts {
  constructor(
    private readonly ledger: StockLedgerRepository,
    private readonly warehouses: WarehouseRepository,
    private readonly imports: ReceiptImportRepository,
    private readonly variants: CatalogVariants,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  async execute(
    file: ReceiptFile,
    options: { dryRun: boolean },
    staffId: string,
  ): Promise<ReceiptImportSummary> {
    const importedAt = await this.imports.importedAt(file.sha256);
    if (importedAt !== null) throw new DuplicateReceiptFileError(importedAt);
    const errors = new ReceiptRowErrors();
    const values = file.rows.flatMap((row) => {
      const parsed = parseRow(row, errors);
      return parsed === null ? [] : [parsed];
    });
    const receipts = await this.receiptsOf(values, errors);
    errors.throwIfAny();
    const units = receipts.reduce((sum, { quantity }) => sum + quantity, 0);

    try {
      await this.transactions.run(async () => {
        const now = this.clock.now();
        const importId = newId<'ReceiptImport'>();
        // First, so the same file imported at the same time waits here, and is refused when this one commits.
        await this.imports.insert({
          id: importId,
          fileSha256: file.sha256,
          rows: file.rows.length,
          units,
          createdBy: staffId,
          createdAt: now,
        });
        await this.lockWarehouses(receipts, errors);
        const computed = await this.compute(receipts, staffId, now, errors);
        await this.ledger.writeReceipts(computed, now);
        if (options.dryRun) throw new DryRunFinished();
        await this.audit.record({
          action: 'inventory.receipt-import',
          resource: { type: 'stock-receipt-import', id: importId },
          changes: changesBetween(
            {},
            { rows: file.rows.length, units, fileSha256: file.sha256 },
          ),
        });
      });
    } catch (error) {
      if (error instanceof DuplicateReceiptFileError) {
        // Another import of the same file committed first; say when.
        throw new DuplicateReceiptFileError(
          await this.imports.importedAt(file.sha256),
        );
      }
      if (!(error instanceof DryRunFinished)) throw error;
    }
    return { rows: file.rows.length, units, dryRun: options.dryRun };
  }

  /** The variants by SKU and the warehouses by code, each with one query; an unknown one is an error of its row. */
  private async receiptsOf(
    values: readonly RowValues[],
    errors: ReceiptRowErrors,
  ): Promise<Receipt[]> {
    const variants = await this.variants.findBySkus(
      values.flatMap(({ sku }) => (sku === undefined ? [] : [sku])),
    );
    const warehouses = new Map(
      (
        await this.warehouses.findByCodes(
          values.flatMap(({ warehouse }) =>
            warehouse === undefined ? [] : [warehouse],
          ),
        )
      ).map((warehouse) => [warehouse.snapshot().code, warehouse]),
    );
    const receipts: Receipt[] = [];
    for (const { line, sku, warehouse: code, quantity, note } of values) {
      const variantId = sku === undefined ? undefined : variants.get(sku);
      if (sku !== undefined && variantId === undefined) {
        errors.add(
          line,
          'sku',
          'unknownSku',
          'No existe una variante con este SKU.',
        );
      }
      const warehouse = code === undefined ? undefined : warehouses.get(code);
      if (code !== undefined && warehouse === undefined) {
        errors.add(
          line,
          'warehouse',
          'unknownWarehouse',
          'No existe un almacén con este código.',
        );
      } else if (warehouse !== undefined && !warehouse.isActive) {
        errors.add(line, 'warehouse', 'inactiveWarehouse', INACTIVE);
      }
      if (
        variantId !== undefined &&
        warehouse?.isActive === true &&
        quantity !== undefined &&
        note !== undefined
      ) {
        receipts.push({
          line,
          variantId,
          warehouseId: warehouse.id,
          quantity,
          note,
        });
      }
    }
    return receipts;
  }

  /**
   * Shares the locks of the warehouses until the end, in ascending ID order, so none is deactivated while it takes
   * the units (ADR-0160); one deactivated since the checks is an error of its rows.
   */
  private async lockWarehouses(
    receipts: readonly Receipt[],
    errors: ReceiptRowErrors,
  ): Promise<void> {
    const active = new Set(
      (
        await this.warehouses.lockManyForStock([
          ...new Set(receipts.map(({ warehouseId }) => warehouseId)),
        ])
      )
        .filter((warehouse: Warehouse) => warehouse.isActive)
        .map(({ id }) => id),
    );
    for (const { line, warehouseId } of receipts) {
      if (!active.has(warehouseId)) {
        errors.add(line, 'warehouse', 'inactiveWarehouse', INACTIVE);
      }
    }
    errors.throwIfAny();
  }

  /**
   * The `onHand` each receipt leaves, in the order of the file, on the stock items locked in ascending ID order
   * (BR-INV-14). One that would go over the most a stock item holds is an error of its row.
   */
  private async compute(
    receipts: readonly Receipt[],
    staffId: string,
    now: Date,
    errors: ReceiptRowErrors,
  ): Promise<ComputedReceipt[]> {
    const key = (variantId: string, warehouseId: string) =>
      `${variantId}/${warehouseId}`;
    const unique = new Map(
      receipts.map(({ variantId, warehouseId }) => [
        key(variantId, warehouseId),
        { variantId, warehouseId },
      ]),
    );
    const items = new Map(
      (await this.ledger.lockItems([...unique.values()], now)).map((item) => [
        key(item.variantId, item.warehouseId),
        { id: item.id, onHand: item.onHand },
      ]),
    );
    const computed = receipts.flatMap((receipt) => {
      const item = items.get(key(receipt.variantId, receipt.warehouseId));
      if (item === undefined) throw new Error('A stock item was not locked');
      item.onHand += receipt.quantity;
      if (item.onHand > MAX_ON_HAND) {
        errors.add(
          receipt.line,
          'quantity',
          'onHandLimit',
          `La existencia pasaría de ${MAX_ON_HAND.toLocaleString('en-US')} unidades.`,
        );
        return [];
      }
      return [
        {
          movementId: newId<'StockMovement'>(),
          stockItemId: item.id,
          quantity: receipt.quantity,
          onHandAfter: item.onHand,
          note: receipt.note,
          actorId: staffId,
        },
      ];
    });
    errors.throwIfAny();
    return computed;
  }
}

/** The values of a row, or `null` after adding its error when it has another number of cells. */
function parseRow(
  row: ReceiptImportRow,
  errors: ReceiptRowErrors,
): RowValues | null {
  if (!row.wellFormed) {
    errors.add(
      row.line,
      null,
      'columnCount',
      'Debe tener tantos valores como columnas tiene el encabezado.',
    );
    return null;
  }
  const fail = (column: string, code: string, message: string) => {
    errors.add(row.line, column, code, message);
    return undefined;
  };
  const quantity = unitsFrom(row.quantity);
  return {
    line: row.line,
    sku:
      row.sku === ''
        ? fail('sku', 'isNotEmpty', REQUIRED)
        : row.sku.toUpperCase(),
    warehouse:
      row.warehouse === ''
        ? fail('warehouse', 'isNotEmpty', REQUIRED)
        : row.warehouse.toUpperCase(),
    quantity:
      row.quantity === ''
        ? fail('quantity', 'isNotEmpty', REQUIRED)
        : (quantity ??
          fail(
            'quantity',
            'quantity',
            'Debe ser un número entero de unidades de 1 a 100,000.',
          )),
    note:
      row.note.length > MAX_NOTE_LENGTH
        ? fail(
            'note',
            'maxLength',
            `Debe tener hasta ${MAX_NOTE_LENGTH} caracteres.`,
          )
        : noteOf(row.note),
  };
}
