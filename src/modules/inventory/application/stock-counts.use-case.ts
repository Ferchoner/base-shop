import { Injectable } from '@nestjs/common';
import {
  assertVersion,
  AuditTrail,
  changesBetween,
  Clock,
  newId,
  NotFoundError,
  type Page,
  type PageRequest,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import type { StockMovementId, VariantId } from '../domain/stock.js';
import {
  type CountClass,
  CountFieldError,
  type CountFilter,
  type CountLine,
  countedOf,
  type CountOutcome,
  type CountStatus,
  differenceOf,
  formatCountFolio,
  locationMatch,
  MAX_COUNT_LINES,
  StockCount,
  type StockCountId,
  type StockCountSnapshot,
  VariantInOpenCountError,
} from '../domain/stock-count.js';
import {
  type LineOutcome,
  type NewCountLine,
  StockCountRepository,
} from '../domain/stock-count.repository.js';
import type { CountEntry } from '../domain/stock-ledger.repository.js';
import { StockLedgerRepository } from '../domain/stock-ledger.repository.js';
import type { WarehouseId } from '../domain/warehouse.js';
import { WarehouseRepository } from '../domain/warehouse.repository.js';
import { CatalogVariants, type VariantLabel } from './catalog-variants.js';
import {
  type CountListFilter,
  CountQueries,
  type CountRecord,
  type CountSummary,
} from './count.queries.js';
import { InventoryQueries } from './inventory.queries.js';

export {
  COUNT_CLASSES,
  COUNT_OUTCOMES,
  COUNT_STATUSES,
  type CountClass,
  type CountOutcome,
  type CountStatus,
  MAX_COUNT_LINES,
  MAX_COUNTED,
  type StockCountId,
} from '../domain/stock-count.js';
export type { CountListFilter } from './count.queries.js';

/**
 * A line of a sheet as the API answers it, with the SKU and the title of its variant. Blind, for whoever cannot
 * review it, `expected` and `difference` are `null` (ADR-0173).
 */
export interface CountLineView {
  readonly variantId: VariantId;
  readonly sku: string;
  readonly productTitle: string;
  readonly position: number;
  readonly location: string | null;
  readonly counted: number | null;
  readonly countedBy: string | null;
  readonly countedAt: Date | null;
  readonly recount: boolean;
  readonly expected: number | null;
  readonly difference: number | null;
  readonly outcome: CountOutcome | null;
  readonly movementId: StockMovementId | null;
}

/** A sheet without its lines, as the listing answers it. */
export interface CountSummaryView {
  readonly id: StockCountId;
  readonly folio: string;
  readonly warehouseId: WarehouseId;
  readonly filter: CountFilter;
  readonly note: string | null;
  readonly status: CountStatus;
  readonly lineCount: number;
  readonly countedCount: number;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly closedBy: string | null;
  readonly closedAt: Date | null;
  readonly version: number;
}

/** `StockCount` of API_SPEC.md §13 (ADR-0173). */
export interface CountView extends CountSummaryView {
  /** Without what was expected and the differences, for whoever cannot review the sheet. */
  readonly blind: boolean;
  readonly lines: readonly CountLineView[];
}

/** A new sheet as the staff sends it. */
export interface CountRequest {
  readonly warehouseId: WarehouseId;
  readonly location?: string;
  readonly categoryId?: string;
  readonly countClass?: CountClass;
  readonly variantIds?: readonly VariantId[];
  readonly note?: string | null;
}

/**
 * Count sheets (T-166, UC-INV-18 to UC-INV-20, ADR-0173): the variants of one warehouse are counted, blind, and the
 * differences are reviewed and adjusted at once. A line keeps the units on hand when it is counted, so what is
 * sold before or after never shows up as missing. A variant is in one open sheet per warehouse. Applying writes a
 * PHYSICAL_COUNT adjustment, linked to the sheet, for each line with a difference; what was not counted is not
 * touched, and a line that would leave fewer units on hand than reserved is skipped and answered. Audited as
 * `inventory.count-open`, `inventory.count-apply` and `inventory.count-cancel`; counting a line is not audited,
 * like a sale.
 */
@Injectable()
export class StockCounts {
  constructor(
    private readonly counts: StockCountRepository,
    private readonly queries: CountQueries,
    private readonly stock: InventoryQueries,
    private readonly ledger: StockLedgerRepository,
    private readonly warehouses: WarehouseRepository,
    private readonly variants: CatalogVariants,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  /**
   * Opens a sheet with the variants of the filter: with a list, exactly those; otherwise those with units on hand
   * or a location in the warehouse that match it. By location (without one last), then SKU.
   *
   * @throws CountFieldError for a filter `countFilterOf` does not allow, or when it takes no line (`noLines`) or
   *   more than 1,000 (`tooManyLines`); InvalidLocationError; InvalidValueError for a long note.
   * @throws NotFoundError when the warehouse or a listed variant does not exist.
   * @throws VariantInOpenCountError with the variants that are in another open sheet of the warehouse.
   */
  async open(request: CountRequest, staffId: string): Promise<CountView> {
    const count = StockCount.open({
      id: newId<'StockCount'>(),
      warehouseId: request.warehouseId,
      filter: {
        location: request.location,
        categoryId: request.categoryId,
        countClass: request.countClass,
        variantIds: request.variantIds,
      },
      note: request.note,
      staffId,
      now: this.clock.now(),
    });
    const { filter } = count.snapshot;
    await this.transactions.run(async () => {
      if ((await this.warehouses.find(request.warehouseId)) === null) {
        throw new NotFoundError('Warehouse', request.warehouseId);
      }
      const lines = await this.linesOf(count);
      if (lines.length === 0 || lines.length > MAX_COUNT_LINES) {
        const field = filterField(filter);
        throw lines.length === 0
          ? new CountFieldError(
              field,
              'noLines',
              'Ninguna variante con existencia o ubicación en el almacén coincide.',
            )
          : new CountFieldError(
              field,
              'tooManyLines',
              `Coinciden más de ${MAX_COUNT_LINES.toLocaleString('en-US')} variantes: acota el filtro.`,
            );
      }
      const saved = await this.counts.insert(count, lines);
      if ('conflicts' in saved) {
        throw new VariantInOpenCountError(saved.conflicts);
      }
      await this.audit.record({
        action: 'inventory.count-open',
        resource: { type: 'stock-count', id: count.id },
        changes: changesBetween(
          {},
          {
            folio: formatCountFolio(saved.number),
            warehouseId: request.warehouseId,
            filter: { ...filter },
            note: count.snapshot.note,
            lines: lines.length,
          },
        ),
      });
    });
    return this.find(count.id, false);
  }

  /**
   * Writes what was counted of a variant; a variant that is not on the sheet is added at the end. It keeps the
   * units on hand now, to compare with, and takes back a recount asked. Blind when `blind`.
   *
   * @throws CountFieldError for a number out of 0 to 100,000.
   * @throws NotFoundError when the sheet or the variant does not exist.
   * @throws InvalidStateTransitionError when the sheet is not OPEN.
   * @throws VariantInOpenCountError when a variant added is in another open sheet of the warehouse.
   */
  async capture(input: {
    id: StockCountId;
    variantId: VariantId;
    counted: number;
    staffId: string;
    blind: boolean;
  }): Promise<CountLineView> {
    const counted = countedOf(input.counted);
    await this.transactions.run(async () => {
      const count = await this.locked(input.id);
      count.changeLines('count');
      const stock = await this.counts.stockOf(count, input.variantId);
      if (!(await this.counts.hasLine(count.id, input.variantId))) {
        if (!(await this.variants.exists(input.variantId))) {
          throw new NotFoundError('Variant', input.variantId);
        }
        const other = await this.counts.addLine(count, {
          variantId: input.variantId,
          location: stock.location,
        });
        if (other !== null) throw new VariantInOpenCountError([other]);
      }
      const now = this.clock.now();
      await this.counts.capture(count.id, input.variantId, {
        counted,
        expected: stock.onHand,
        countedBy: input.staffId,
        countedAt: now,
      });
      await this.counts.save(count, now);
    });
    const view = await this.find(input.id, input.blind);
    const line = view.lines.find(
      ({ variantId }) => variantId === input.variantId,
    );
    if (line === undefined) throw new Error('A counted line is on its sheet');
    return line;
  }

  /**
   * Clears what was counted of a line and marks it to count again.
   *
   * @throws NotFoundError when the sheet or its line does not exist; VersionConflictError;
   *   InvalidStateTransitionError when the sheet is not OPEN.
   */
  async recount(input: {
    id: StockCountId;
    variantId: VariantId;
    version: number;
  }): Promise<CountView> {
    await this.transactions.run(async () => {
      const count = await this.locked(input.id);
      assertVersion(count.version, input.version);
      count.changeLines('recount');
      if (!(await this.counts.hasLine(count.id, input.variantId))) {
        throw new NotFoundError(
          'StockCountLine',
          `${input.id}/${input.variantId}`,
        );
      }
      await this.counts.recount(count.id, input.variantId);
      await this.counts.save(count, this.clock.now());
    });
    return this.find(input.id, false);
  }

  /**
   * Applies a sheet: a PHYSICAL_COUNT adjustment of its difference for each counted line that has one. A line
   * that would leave fewer units on hand than reserved is SKIPPED_RESERVED, and the others still apply.
   *
   * @throws NotFoundError; VersionConflictError; InvalidStateTransitionError when it is not OPEN.
   */
  async apply(input: {
    id: StockCountId;
    version: number;
    staffId: string;
  }): Promise<CountView> {
    await this.transactions.run(async () => {
      const count = await this.locked(input.id);
      assertVersion(count.version, input.version);
      const now = this.clock.now();
      count.apply(input.staffId, now);
      const counted = await this.counts.countedLines(count.id);
      const note = `Conteo ${formatCountFolio(numberOf(count.snapshot))}`;
      const entries: CountEntry[] = counted
        .filter(({ difference }) => difference !== 0)
        .map(({ variantId, difference }) => ({
          movementId: newId<'StockMovement'>(),
          warehouseId: count.snapshot.warehouseId,
          variantId,
          quantity: difference,
          note,
          actorId: input.staffId,
          at: now,
          countId: count.id,
        }));
      const { skipped } = await this.ledger.countAdjust(entries);
      const skippedSet = new Set(skipped);
      const outcomes: LineOutcome[] = [
        ...counted
          .filter(({ difference }) => difference === 0)
          .map(({ variantId }) => ({
            variantId,
            outcome: 'NO_DIFFERENCE' as const,
            movementId: null,
          })),
        ...entries.map(({ variantId, movementId }) =>
          skippedSet.has(variantId)
            ? {
                variantId,
                outcome: 'SKIPPED_RESERVED' as const,
                movementId: null,
              }
            : { variantId, outcome: 'ADJUSTED' as const, movementId },
        ),
      ];
      const notCounted = await this.counts.closeLines(count.id, outcomes);
      await this.counts.save(count, now);
      await this.audit.record({
        action: 'inventory.count-apply',
        resource: { type: 'stock-count', id: count.id },
        changes: changesBetween(
          { status: 'OPEN' },
          {
            status: 'APPLIED',
            adjusted: entries.length - skipped.length,
            noDifference: counted.length - entries.length,
            notCounted,
            skippedReserved: [...skipped],
          },
        ),
      });
    });
    return this.find(input.id, false);
  }

  /**
   * Cancels a sheet, with nothing adjusted; its variants can go in another one.
   *
   * @throws NotFoundError; VersionConflictError; InvalidStateTransitionError when it is not OPEN.
   */
  async cancel(input: {
    id: StockCountId;
    version: number;
    staffId: string;
  }): Promise<CountView> {
    await this.transactions.run(async () => {
      const count = await this.locked(input.id);
      assertVersion(count.version, input.version);
      const now = this.clock.now();
      count.cancel(input.staffId, now);
      await this.counts.closeLines(count.id, null);
      await this.counts.save(count, now);
      await this.audit.record({
        action: 'inventory.count-cancel',
        resource: { type: 'stock-count', id: count.id },
        changes: changesBetween({ status: 'OPEN' }, { status: 'CANCELLED' }),
      });
    });
    return this.find(input.id, false);
  }

  /** @throws NotFoundError when the sheet does not exist. */
  async find(id: StockCountId, blind: boolean): Promise<CountView> {
    const found = await this.queries.findCount(id);
    if (found === null) throw new NotFoundError('StockCount', id);
    const labels = await this.variants.labels(
      found.lines.map(({ variantId }) => variantId),
    );
    return viewOf(found, labels, blind);
  }

  async list(
    filter: CountListFilter,
    page: PageRequest,
  ): Promise<Page<CountSummaryView>> {
    const found = await this.queries.pageOfCounts(filter, page);
    return { items: found.items.map(summaryOf), totalItems: found.totalItems };
  }

  /** @throws NotFoundError when the sheet does not exist. */
  private async locked(id: StockCountId): Promise<StockCount> {
    const count = await this.counts.lock(id);
    if (count === null) throw new NotFoundError('StockCount', id);
    return count;
  }

  /**
   * The lines of a new sheet, by location (without one last) and then SKU.
   *
   * @throws NotFoundError for the first listed variant that does not exist.
   */
  private async linesOf(count: StockCount): Promise<NewCountLine[]> {
    const { warehouseId, filter } = count.snapshot;
    if (filter.variantIds !== undefined) {
      const variantIds = filter.variantIds;
      const labels = await this.variants.labels(variantIds);
      const missing = variantIds.find((id) => !labels.has(id));
      if (missing !== undefined) throw new NotFoundError('Variant', missing);
      const stock = await this.stock.allStock({ warehouseId, variantIds });
      const locations = new Map(
        stock.map(({ variantId, location }) => [variantId, location]),
      );
      return sorted(
        variantIds.map((variantId) => ({
          variantId,
          location: locations.get(variantId) ?? null,
        })),
        labels,
      );
    }
    const variantIds =
      filter.categoryId === undefined && filter.countClass === undefined
        ? undefined
        : await this.variants.forCount({
            categoryId: filter.categoryId,
            countClass: filter.countClass,
          });
    const stock = await this.stock.allStock({
      warehouseId,
      variantIds,
      ...(filter.location === undefined ? {} : locationMatch(filter.location)),
    });
    const lines = stock
      .filter(({ onHand, location }) => onHand > 0 || location !== null)
      .map(({ variantId, location }) => ({ variantId, location }));
    // Past the most, the caller answers it without reading the SKUs.
    if (lines.length > MAX_COUNT_LINES) return lines;
    return sorted(
      lines,
      await this.variants.labels(lines.map(({ variantId }) => variantId)),
    );
  }
}

/** The field a sheet that takes no line, or too many, is answered on: the first filter it was opened with. */
function filterField(filter: CountFilter): string {
  if (filter.location !== undefined) return 'location';
  if (filter.categoryId !== undefined) return 'categoryId';
  if (filter.countClass !== undefined) return 'countClass';
  return 'variantIds';
}

/** By location, those without one last, and then by SKU; plain code-point order, so it never depends on a locale. */
function sorted(
  lines: readonly NewCountLine[],
  labels: ReadonlyMap<VariantId, VariantLabel>,
): NewCountLine[] {
  const skuOf = (line: NewCountLine) => labels.get(line.variantId)?.sku ?? '';
  const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return [...lines].sort((a, b) => {
    if (a.location !== b.location) {
      if (a.location === null) return 1;
      if (b.location === null) return -1;
      return compare(a.location, b.location);
    }
    return compare(skuOf(a), skuOf(b));
  });
}

function numberOf(count: StockCountSnapshot): number {
  if (count.number === null) {
    throw new Error(`Count sheet ${count.id} has no number`);
  }
  return count.number;
}

function summaryOf(count: CountSummary): CountSummaryView {
  return {
    id: count.id,
    folio: formatCountFolio(numberOf(count)),
    warehouseId: count.warehouseId,
    filter: count.filter,
    note: count.note,
    status: count.status,
    lineCount: count.lineCount,
    countedCount: count.countedCount,
    createdBy: count.createdBy,
    createdAt: count.createdAt,
    closedBy: count.closedBy,
    closedAt: count.closedAt,
    version: count.version,
  };
}

function viewOf(
  count: CountRecord,
  labels: ReadonlyMap<VariantId, VariantLabel>,
  blind: boolean,
): CountView {
  return {
    ...summaryOf(count),
    blind,
    lines: count.lines.map((line) => lineViewOf(count, line, labels, blind)),
  };
}

function lineViewOf(
  count: CountRecord,
  line: CountLine,
  labels: ReadonlyMap<VariantId, VariantLabel>,
  blind: boolean,
): CountLineView {
  const label = labels.get(line.variantId);
  // Variants are never deleted (ADR-0038), so every line has one.
  if (label === undefined) {
    throw new Error(`Count sheet ${count.id} has no variant in Catalog`);
  }
  return {
    variantId: line.variantId,
    sku: label.sku,
    productTitle: label.productTitle,
    position: line.position,
    location: line.location,
    counted: line.counted,
    countedBy: line.countedBy,
    countedAt: line.countedAt,
    recount: line.recount,
    expected: blind ? null : line.expected,
    difference: blind ? null : differenceOf(line),
    outcome: line.outcome,
    movementId: line.movementId,
  };
}
