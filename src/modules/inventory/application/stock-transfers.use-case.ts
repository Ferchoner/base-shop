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
  type ReturnedLine,
  StockTransfer,
  type StockTransferId,
  type StockTransferSnapshot,
  type TransferKind,
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
  MAX_LOAN_MS,
  MAX_TRANSFER_LINES,
  MIN_LOAN_MS,
  REQUESTED_TRANSFER_REASONS,
  type ReturnedLine,
  type StockTransferId,
  TRANSFER_KINDS,
  TRANSFER_REASONS,
  TRANSFER_STATUSES,
  type TransferKind,
  type TransferReason,
  type TransferStatus,
} from '../domain/stock-transfer.js';
export type { TransferFilter } from './transfer.queries.js';

/** A line of a transfer as the API answers it, with the SKU and the title of its variant. */
export interface TransferLineView extends TransferLine {
  readonly sku: string;
  readonly productTitle: string;
  /** Units of a loan line that came back when it was closed; `null` until then, and always in a transfer. */
  readonly returned: number | null;
}

/** `StockTransfer` of API_SPEC.md §13 (ADR-0172). */
export interface TransferView {
  readonly id: StockTransferId;
  readonly folio: string;
  readonly kind: TransferKind;
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
  /** When a loan should come back; `null` in a transfer. */
  readonly returnBy: Date | null;
  /** An open loan whose time to come back passed. */
  readonly overdue: boolean;
  readonly closedBy: string | null;
  readonly closedAt: Date | null;
  /** In the return of a loan, the loan. */
  readonly loanId: StockTransferId | null;
  /** In a closed loan, the transfer that brought back its units, if any came back. */
  readonly returnTransferId: StockTransferId | null;
  readonly version: number;
}

/** A new transfer or loan as the staff sends it. */
export interface TransferRequest {
  readonly kind?: TransferKind;
  readonly returnBy?: Date | null;
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
 * rewritten. A loan (T-164) moves the units the same way to show them, with a time to come back, and is closed with
 * what came back. Audited as `inventory.transfer`, `inventory.transfer-cancel` and `inventory.loan-close`.
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
            folio: formatTransferFolio(saved, transfer.snapshot.kind),
            kind: transfer.snapshot.kind,
            fromWarehouseId,
            toWarehouseId,
            reason: transfer.snapshot.reason,
            note: transfer.snapshot.note,
            returnBy: transfer.snapshot.returnBy,
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
      const before = transfer.snapshot.status;
      transfer.cancel(input.staffId, now);
      await this.move(transfer, -1, input.staffId, now);
      await this.transfers.save(transfer, now);
      await this.audit.record({
        action: 'inventory.transfer-cancel',
        resource: { type: 'stock-transfer', id: transfer.id },
        changes: changesBetween({ status: before }, { status: 'CANCELLED' }),
      });
    });
    return this.find(input.id);
  }

  /**
   * Closes an open loan (T-164) with the units of each line that came back: those go back to the origin with a
   * transfer `LOAN_RETURN` linked to the loan, and the rest stays in the destination. The origin may be inactive by
   * then; the units go back to it anyway, like a restock (ADR-0160).
   *
   * @throws NotFoundError; VersionConflictError; InvalidStateTransitionError when it is not an open loan;
   *   TransferFieldError for lines that are not every line of the loan once, or units out of range;
   *   InsufficientStockError when the destination no longer has the units that came back available.
   */
  async close(input: {
    id: StockTransferId;
    version: number;
    lines: readonly ReturnedLine[];
    staffId: string;
  }): Promise<TransferView> {
    await this.transactions.run(async () => {
      const loan = await this.transfers.lock(input.id);
      if (loan === null) throw new NotFoundError('StockTransfer', input.id);
      assertVersion(loan.version, input.version);
      const now = this.clock.now();
      loan.close(input.lines, input.staffId, now);
      await this.transfers.save(loan, now);
      let returnFolio: string | null = null;
      if (loan.lines.some(({ returned }) => (returned ?? 0) > 0)) {
        const back = StockTransfer.returnOf(loan, {
          id: newId<'StockTransfer'>(),
          staffId: input.staffId,
          now,
        });
        returnFolio = formatTransferFolio(
          await this.transfers.insert(back, now),
        );
        await this.move(back, 1, input.staffId, now);
      }
      await this.audit.record({
        action: 'inventory.loan-close',
        resource: { type: 'stock-transfer', id: loan.id },
        changes: changesBetween(
          { status: 'OPEN' },
          {
            status: 'CLOSED',
            returnFolio,
            lines: loan.lines.map(({ variantId, quantity, returned }) => ({
              variantId,
              quantity,
              returned,
            })),
          },
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
    return viewOf(found, labels, this.clock.now());
  }

  async list(
    filter: TransferFilter,
    page: PageRequest,
  ): Promise<Page<TransferView>> {
    const now = this.clock.now();
    const found = await this.queries.pageOfTransfers({ ...filter, now }, page);
    const labels = await this.variants.labels([
      ...new Set(
        found.items.flatMap(({ lines }) =>
          lines.map(({ variantId }) => variantId),
        ),
      ),
    ]);
    return {
      items: found.items.map((transfer) => viewOf(transfer, labels, now)),
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
  now: Date,
): TransferView {
  if (transfer.number === null) {
    throw new Error(`Transfer ${transfer.id} has no number`);
  }
  const restored = StockTransfer.restore(transfer);
  return {
    id: transfer.id,
    folio: formatTransferFolio(transfer.number, transfer.kind),
    kind: transfer.kind,
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
    cancellableUntil: restored.isCancellable ? restored.cancellableUntil : null,
    cancelledBy: transfer.cancelledBy,
    cancelledAt: transfer.cancelledAt,
    returnBy: transfer.returnBy,
    overdue: restored.isOverdue(now),
    closedBy: transfer.closedBy,
    closedAt: transfer.closedAt,
    loanId: transfer.loanId,
    returnTransferId: transfer.returnTransferId,
    version: transfer.version,
  };
}
