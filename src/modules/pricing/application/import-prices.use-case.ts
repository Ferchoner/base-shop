import { Injectable } from '@nestjs/common';
import {
  AuditTrail,
  changesBetween,
  Clock,
  Money,
  newId,
  NotFoundError,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import type { PriceListId } from '../domain/price-list.js';
import { PriceListRepository } from '../domain/price-list.repository.js';
import {
  PricePeriodConflictError,
  type VariantId,
} from '../domain/variant-price.js';
import { VariantPriceRepository } from '../domain/variant-price.repository.js';
import { CatalogVariants } from './catalog-variants.js';
import {
  centsFromPesos,
  instantFrom,
  type PriceImportRow,
  type PriceImportSummary,
  PriceRowErrors,
} from './price-import.js';

/** A row whose values are all valid. */
interface PriceRow {
  readonly line: number;
  /** In uppercase, as SKUs are stored (BR-PRD-09). */
  readonly sku: string;
  readonly amount: number;
  readonly compareAtAmount: number | null;
  /** `null`: from now on. */
  readonly effectiveFrom: Date | null;
}

const REQUIRED = 'Es obligatorio.';
const PESOS =
  'Debe ser un monto en pesos con punto decimal y hasta 2 decimales, como 599.00.';

/** Ends the import of a dry run after every check, so its transaction rolls back. */
class DryRunFinished extends Error {}

/**
 * Bulk import of prices (UC-PRC-05, ADR-0126): each row sets or schedules a price as `POST …/periods` does
 * (ADR-0125), all or nothing. Every row is checked first; with any error, nothing is imported and the answer
 * lists the errors by line. Otherwise the rows are applied in one transaction that locks every variant of the
 * file at once, and the import is audited once with its counts; one that creates no period saves and audits
 * nothing. With `dryRun`, the same checks run and the transaction rolls back.
 */
@Injectable()
export class ImportPrices {
  constructor(
    private readonly lists: PriceListRepository,
    private readonly prices: VariantPriceRepository,
    private readonly variants: CatalogVariants,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  async execute(
    priceListId: PriceListId,
    rows: readonly PriceImportRow[],
    options: { dryRun: boolean },
    staffId: string,
  ): Promise<PriceImportSummary> {
    if (!(await this.lists.exists(priceListId))) {
      throw new NotFoundError('PriceList', priceListId);
    }
    const errors = new PriceRowErrors();
    const valid = rows.flatMap((row) => {
      const parsed = parseRow(row, errors);
      return parsed === null ? [] : [parsed];
    });
    const variants = await this.variants.findBySkus(
      valid.map(({ sku }) => sku),
    );
    const known = valid.filter(({ line, sku }) => {
      if (variants.has(sku)) return true;
      errors.add(
        line,
        'sku',
        'unknownSku',
        'No existe una variante con este SKU.',
      );
      return false;
    });
    rejectRepeatedStarts(known, this.clock.now(), errors);
    errors.throwIfAny();

    let created = 0;
    let unchanged = 0;
    try {
      await this.transactions.run(async () => {
        const locked = new Map(
          (
            await this.prices.lock(
              priceListId,
              known.map(({ sku }) => variantOf(variants, sku)),
            )
          ).map((prices) => [prices.variantId, prices]),
        );
        // Read after the lock, like a single price (ADR-0125); every row from now on starts at this instant.
        const now = this.clock.now();
        // Rows with different starts give the same line in any order, so they go in the order of the file.
        for (const row of known) {
          const prices = locked.get(variantOf(variants, row.sku));
          if (prices === undefined) throw new Error('A variant was not locked');
          try {
            const { change } = prices.set(
              {
                id: newId<'PricePeriod'>(),
                amount: Money.of(row.amount, 'MXN'),
                compareAtAmount:
                  row.compareAtAmount === null
                    ? null
                    : Money.of(row.compareAtAmount, 'MXN'),
                effectiveFrom: row.effectiveFrom,
                createdBy: staffId,
              },
              now,
            );
            if (change === 'unchanged') unchanged += 1;
            else created += 1;
          } catch (error) {
            if (!(error instanceof PricePeriodConflictError)) throw error;
            errors.add(
              row.line,
              'effectiveFrom',
              'overlap',
              'Ya hay otro precio de la variante que empieza en el mismo instante.',
            );
          }
        }
        errors.throwIfAny();
        if (options.dryRun) throw new DryRunFinished();
        // The same file again changes nothing, so nothing is saved or audited.
        if (created === 0) return;
        await this.prices.save([...locked.values()]);
        await this.audit.record({
          action: 'prices.import',
          resource: { type: 'price-list', id: priceListId },
          changes: changesBetween(
            {},
            { rows: rows.length, created, unchanged },
          ),
        });
      });
    } catch (error) {
      if (!(error instanceof DryRunFinished)) throw error;
    }
    return { rows: rows.length, created, unchanged, dryRun: options.dryRun };
  }
}

/** The values of a row, or `null` after adding its errors. */
function parseRow(
  row: PriceImportRow,
  errors: PriceRowErrors,
): PriceRow | null {
  if (!row.wellFormed) {
    errors.add(
      row.line,
      null,
      'columnCount',
      'Debe tener tantos valores como columnas tiene el encabezado.',
    );
    return null;
  }
  let valid = true;
  const fail = (column: string, code: string, message: string) => {
    errors.add(row.line, column, code, message);
    valid = false;
  };
  if (row.sku === '') fail('sku', 'isNotEmpty', REQUIRED);
  const amount = centsFromPesos(row.amount);
  if (row.amount === '') fail('amount', 'isNotEmpty', REQUIRED);
  else if (amount === null) fail('amount', 'pesos', PESOS);
  const compareAtAmount =
    row.compareAtAmount === '' ? null : centsFromPesos(row.compareAtAmount);
  if (row.compareAtAmount !== '' && compareAtAmount === null) {
    fail('compareAtAmount', 'pesos', PESOS);
  } else if (
    amount !== null &&
    compareAtAmount !== null &&
    compareAtAmount <= amount
  ) {
    fail('compareAtAmount', 'compareAtAmount', 'Debe ser mayor que amount.');
  }
  const effectiveFrom =
    row.effectiveFrom === '' ? null : instantFrom(row.effectiveFrom);
  if (row.effectiveFrom !== '' && effectiveFrom === null) {
    fail(
      'effectiveFrom',
      'dateTime',
      'Debe ser fecha y hora de México, como 2026-11-14 00:00, o ISO 8601 con zona horaria.',
    );
  }
  return valid && amount !== null
    ? {
        line: row.line,
        sku: row.sku.toUpperCase(),
        amount,
        compareAtAmount,
        effectiveFrom,
      }
    : null;
}

/**
 * A SKU may come several times with different starts, but never twice with the same one: a row from now on
 * and another one dated now or before start at the same instant.
 */
function rejectRepeatedStarts(
  rows: readonly PriceRow[],
  now: Date,
  errors: PriceRowErrors,
): void {
  const starts = new Set<string>();
  for (const { line, sku, effectiveFrom } of rows) {
    const start =
      effectiveFrom === null || effectiveFrom <= now
        ? 'now'
        : effectiveFrom.toISOString();
    const key = `${sku} ${start}`;
    if (starts.has(key)) {
      errors.add(
        line,
        'effectiveFrom',
        'repeatedStart',
        'Otra fila del mismo SKU empieza en el mismo instante.',
      );
    }
    starts.add(key);
  }
}

function variantOf(
  variants: ReadonlyMap<string, VariantId>,
  sku: string,
): VariantId {
  const variant = variants.get(sku);
  if (variant === undefined) throw new Error(`SKU ${sku} was not found`);
  return variant;
}
