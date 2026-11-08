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
import { InsufficientStockError, type VariantId } from '../domain/stock.js';
import type { TransferEntry } from '../domain/stock-ledger.repository.js';
import { StockLedgerRepository } from '../domain/stock-ledger.repository.js';
import {
  formatTransferFolio,
  StockTransfer,
  type StockTransferId,
  type StockTransferSnapshot,
  type TransferLine,
  type TransferReason,
  type TransferStatus,
} from '../domain/stock-transfer.js';
import { StockTransferRepository } from '../domain/stock-transfer.repository.js';
import type { WarehouseId } from '../domain/warehouse.js';
import { WarehouseRepository } from '../domain/warehouse.repository.js';
import { CatalogVariants, type VariantLabel } from './catalog-variants.js';
import { type TransferFilter, TransferQueries } from './transfer.queries.js';

export {
  MAX_TRANSFER_LINES,
  type StockTransferId,
  TRANSFER_REASONS,
  TRANSFER_STATUSES,
  type TransferReason,
  type TransferStatus,
} from '../domain/stock-transfer.js';
export type { TransferFilter } from './transfer.queries.js';

/** A line of a transfer as the API answers it, with the SKU and the title of its variant. */
export interface TransferLineView extends TransferLine {
  readonly sku: string;
  readonly productTitle: string;
}

/** `StockTransfer` of API_SPEC.md §13 (ADR-0172). */
export interface TransferView {
  readonly id: StockTransferId;
  readonly folio: string;
  readonly fromWarehouseId: WarehouseId;
  readonly toWarehouseId: WarehouseId;
  readonly reason: TransferReason;
  readonly note: string | null;
  readonly status: TransferStatus;
  readonly lines: readonly TransferLineView[];
  readonly createdBy: string;
  readonly createdAt: Date;
  /** Until when it can be cancelled; `null` once cancelled. */
  readonly cancellableUntil: Date | null;
  readonly cancelledBy: string | null;
  readonly cancelledAt: Date | null;
  readonly version: number;
}

/** A new transfer as the staff sends it. */
export interface TransferRequest {
  readonly fromWarehouseId: WarehouseId;
  readonly toWarehouseId: WarehouseId;
  readonly reason: TransferReason;
  readonly note?: string | null;
  readonly lines: readonly TransferLine[];
}

/**
 * Transfers between warehouses (T-163, ADR-0172): units of one or more variants leave one warehouse and enter
 * another in one transaction, with a folio. Only the units available move: the reserved ones stay for their orders.
 * The destination must be active; the origin may be inactive, to empty it. A transfer is cancelled only in its
 * first 10 minutes, and its units go back to the origin with movements of the opposite sign; the ledger is never
 * rewritten. Audited as `inventory.transfer` and `inventory.transfer-cancel`.
 */
@Injectable()
export class StockTransfers {
  constructor(
    private readonly transfers: StockTransferRepository,
    private readonly queries: TransferQueries,
    private readonly ledger: StockLedgerRepository,
    private readonly warehouses: WarehouseRepository,
    private readonly variants: CatalogVariants,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  /**
   * Records a transfer and moves its units.
   *
   * @throws TransferFieldError or InvalidValueError for a transfer the rules do not allow (StockTransfer.record).
   * @throws NotFoundError when a variant does not exist, the origin does not exist or the destination does not
   *   exist or is inactive.
   * @throws InsufficientStockError with every variant whose available units at the origin are not enough.
   */
  async record(
    request: TransferRequest,
    staffId: string,
  ): Promise<TransferView> {
    const transfer = StockTransfer.record({
      ...request,
      id: newId<'StockTransfer'>(),
      staffId,
      now: this.clock.now(),
    });
    await this.requireVariants(
      transfer.lines.map(({ variantId }) => variantId),
    );
    const { fromWarehouseId, toWarehouseId } = transfer.snapshot;
    await this.transactions.run(async () => {
      // Shared until the end, in ID order, so neither is deactivated while the units move (ADR-0160).
      const locked = await this.warehouses.lockManyForStock([
        fromWarehouseId,
        toWarehouseId,
      ]);
      const from = locked.find(({ id }) => id === fromWarehouseId);
      const to = locked.find(({ id }) => id === toWarehouseId);
      if (from === undefined) {
        throw new NotFoundError('Warehouse', fromWarehouseId);
      }
      // Only an active warehouse takes stock; another one is answered as missing.
      if (to === undefined || !to.isActive) {
        throw new NotFoundError('Warehouse', toWarehouseId);
      }
      const saved = await this.transfers.insert(
        transfer,
        transfer.snapshot.createdAt,
      );
      await this.move(transfer, 1, staffId, transfer.snapshot.createdAt);
      await this.audit.record({
        action: 'inventory.transfer',
        resource: { type: 'stock-transfer', id: transfer.id },
        changes: changesBetween(
          {},
          {
            folio: formatTransferFolio(saved),
            fromWarehouseId,
            toWarehouseId,
            reason: transfer.snapshot.reason,
            note: transfer.snapshot.note,
            lines: transfer.lines.map(({ variantId, quantity }) => ({
              variantId,
              quantity,
            })),
          },
        ),
      });
    });
    // Read back, so the lines come in the same order as in the listing and the detail.
    return this.find(transfer.id);
  }

  /**
   * Cancels a transfer in its first 10 minutes: its units go back to the origin.
   *
   * @throws NotFoundError; VersionConflictError; InvalidStateTransitionError when it is already cancelled;
   *   TransferCancelWindowError after 10 minutes; InsufficientStockError when the destination no longer has the
   *   units available.
   */
  async cancel(input: {
    id: StockTransferId;
    version: number;
    staffId: string;
  }): Promise<TransferView> {
    await this.transactions.run(async () => {
      const transfer = await this.transfers.lock(input.id);
      if (transfer === null) {
        throw new NotFoundError('StockTransfer', input.id);
      }
      assertVersion(transfer.version, input.version);
      const now = this.clock.now();
      transfer.cancel(input.staffId, now);
      await this.move(transfer, -1, input.staffId, now);
      await this.transfers.save(transfer, now);
      await this.audit.record({
        action: 'inventory.transfer-cancel',
        resource: { type: 'stock-transfer', id: transfer.id },
        changes: changesBetween(
          { status: 'COMPLETED' },
          { status: 'CANCELLED' },
        ),
      });
    });
    return this.find(input.id);
  }

  /** @throws NotFoundError when the transfer does not exist. */
  async find(id: StockTransferId): Promise<TransferView> {
    const found = await this.queries.findTransfer(id);
    if (found === null) throw new NotFoundError('StockTransfer', id);
    const labels = await this.variants.labels(
      found.lines.map(({ variantId }) => variantId),
    );
    return viewOf(found, labels);
  }

  async list(
    filter: TransferFilter,
    page: PageRequest,
  ): Promise<Page<TransferView>> {
    const found = await this.queries.pageOfTransfers(filter, page);
    const labels = await this.variants.labels([
      ...new Set(
        found.items.flatMap(({ lines }) =>
          lines.map(({ variantId }) => variantId),
        ),
      ),
    ]);
    return {
      items: found.items.map((transfer) => viewOf(transfer, labels)),
      totalItems: found.totalItems,
    };
  }

  /**
   * Both sides of every line: `direction` 1 takes the units from the origin to the destination, and -1 brings them
   * back.
   *
   * @throws InsufficientStockError with every variant whose side that takes units does not apply.
   */
  private async move(
    transfer: StockTransfer,
    direction: 1 | -1,
    staffId: string,
    at: Date,
  ): Promise<void> {
    const { fromWarehouseId, toWarehouseId, note } = transfer.snapshot;
    const entries: TransferEntry[] = transfer.lines.flatMap(
      ({ variantId, quantity }) =>
        [
          { warehouseId: fromWarehouseId, quantity: -direction * quantity },
          { warehouseId: toWarehouseId, quantity: direction * quantity },
        ].map((side) => ({
          ...side,
          movementId: newId<'StockMovement'>(),
          variantId,
          note,
          actorId: staffId,
          at,
          transferId: transfer.id,
        })),
    );
    const { short } = await this.ledger.transfer(entries);
    if (short.length > 0) throw new InsufficientStockError(short);
  }

  /** @throws NotFoundError for the first variant that does not exist, in any status. */
  private async requireVariants(
    variantIds: readonly VariantId[],
  ): Promise<void> {
    const labels = await this.variants.labels(variantIds);
    const missing = variantIds.find((id) => !labels.has(id));
    if (missing !== undefined) throw new NotFoundError('Variant', missing);
  }
}

function viewOf(
  transfer: StockTransferSnapshot,
  labels: ReadonlyMap<VariantId, VariantLabel>,
): TransferView {
  if (transfer.number === null) {
    throw new Error(`Transfer ${transfer.id} has no number`);
  }
  const restored = StockTransfer.restore(transfer);
  return {
    id: transfer.id,
    folio: formatTransferFolio(transfer.number),
    fromWarehouseId: transfer.fromWarehouseId,
    toWarehouseId: transfer.toWarehouseId,
    reason: transfer.reason,
    note: transfer.note,
    status: transfer.status,
    lines: transfer.lines.map((line) => {
      const label = labels.get(line.variantId);
      // Variants are never deleted (ADR-0038), so every line has one.
      if (label === undefined) {
        throw new Error(`Transfer ${transfer.id} has no variant in Catalog`);
      }
      return { ...line, ...label };
    }),
    createdBy: transfer.createdBy,
    createdAt: transfer.createdAt,
    cancellableUntil:
      transfer.status === 'COMPLETED' ? restored.cancellableUntil : null,
    cancelledBy: transfer.cancelledBy,
    cancelledAt: transfer.cancelledAt,
    version: transfer.version,
  };
}
