import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { Prisma } from '../../../platform/persistence/prisma/generated/client.js';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import {
  pageOffset,
  type Page,
  type PageRequest,
  toId,
  VersionConflictError,
} from '../../../shared-kernel/index.js';
import type { TransferFilter } from '../application/transfer.queries.js';
import { TransferQueries } from '../application/transfer.queries.js';
import {
  StockTransfer,
  type StockTransferId,
  type StockTransferSnapshot,
} from '../domain/stock-transfer.js';
import { StockTransferRepository } from '../domain/stock-transfer.repository.js';

/** The lines of a transfer, in the order of their variants, and the return of a loan. */
const WITH_LINES = {
  lines: { orderBy: { variantId: 'asc' as const } },
  returnOf: { select: { id: true } },
} satisfies Prisma.StockTransferInclude;

type TransferRow = Prisma.StockTransferGetPayload<{
  include: typeof WITH_LINES;
}>;

/**
 * Transfers and loans between warehouses in PostgreSQL (DATABASE.md §6.7, ADR-0172). The number of the folio comes from the
 * sequence of `number`, so it is consecutive, with a gap only when a transaction that took one fails, like the
 * folios of work orders (ADR-0166). A cancellation locks the row and saves only over the version it read. Dates
 * come from the application, never from the database clock.
 */
@Injectable()
export class PrismaStockTransferRepository extends StockTransferRepository {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  async insert(transfer: StockTransfer, now: Date): Promise<number> {
    const t = transfer.snapshot;
    const { number } = await this.txHost.tx.stockTransfer.create({
      select: { number: true },
      data: {
        id: t.id,
        kind: t.kind,
        fromWarehouseId: t.fromWarehouseId,
        toWarehouseId: t.toWarehouseId,
        reason: t.reason,
        note: t.note,
        status: t.status,
        createdBy: t.createdBy,
        createdAt: t.createdAt,
        cancelledBy: t.cancelledBy,
        cancelledAt: t.cancelledAt,
        returnBy: t.returnBy,
        closedBy: t.closedBy,
        closedAt: t.closedAt,
        loanId: t.loanId,
        version: t.version,
        updatedAt: now,
        lines: {
          create: t.lines.map(({ variantId, quantity, returned }) => ({
            variantId,
            quantity,
            returned,
          })),
        },
      },
    });
    return Number(number);
  }

  async lock(id: StockTransferId): Promise<StockTransfer | null> {
    const tx = this.txHost.tx;
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM stock_transfers WHERE id = ${id}::uuid FOR UPDATE`;
    if (locked.length === 0) return null;
    const row = await tx.stockTransfer.findUniqueOrThrow({
      where: { id },
      include: WITH_LINES,
    });
    return StockTransfer.restore(toSnapshot(row));
  }

  async save(transfer: StockTransfer, now: Date): Promise<void> {
    const t = transfer.snapshot;
    const tx = this.txHost.tx;
    const { count } = await tx.stockTransfer.updateMany({
      where: { id: t.id, version: t.version },
      data: {
        status: t.status,
        cancelledBy: t.cancelledBy,
        cancelledAt: t.cancelledAt,
        closedBy: t.closedBy,
        closedAt: t.closedAt,
        version: { increment: 1 },
        updatedAt: now,
      },
    });
    if (count === 0) {
      const current = await tx.stockTransfer.findUnique({
        select: { version: true },
        where: { id: t.id },
      });
      throw new VersionConflictError(current?.version ?? t.version);
    }
    // Only the closing of a loan changes its lines: what came back of each one.
    for (const { variantId, returned } of t.lines) {
      if (returned === null) continue;
      await tx.stockTransferLine.update({
        where: { transferId_variantId: { transferId: t.id, variantId } },
        data: { returned },
      });
    }
  }
}

/** Read models of transfers (ADR-0172), in the active transaction when there is one. */
@Injectable()
export class PrismaTransferQueries extends TransferQueries {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  async pageOfTransfers(
    filter: TransferFilter,
    page: PageRequest,
  ): Promise<Page<StockTransferSnapshot>> {
    const where = whereOf(filter);
    const tx = this.txHost.tx;
    const [rows, totalItems] = await Promise.all([
      tx.stockTransfer.findMany({
        where,
        include: WITH_LINES,
        orderBy: [{ createdAt: 'desc' }, { number: 'desc' }],
        skip: pageOffset(page),
        take: page.pageSize,
      }),
      tx.stockTransfer.count({ where }),
    ]);
    return { items: rows.map(toSnapshot), totalItems };
  }

  async findTransfer(
    id: StockTransferId,
  ): Promise<StockTransferSnapshot | null> {
    const row = await this.txHost.tx.stockTransfer.findUnique({
      where: { id },
      include: WITH_LINES,
    });
    return row === null ? null : toSnapshot(row);
  }
}

function whereOf(filter: TransferFilter): Prisma.StockTransferWhereInput {
  const overdue: Prisma.StockTransferWhereInput = {
    status: 'OPEN',
    returnBy: { lt: filter.now },
  };
  return {
    ...(filter.kind === undefined ? {} : { kind: filter.kind }),
    ...(filter.overdue === undefined
      ? {}
      : filter.overdue
        ? overdue
        : { NOT: overdue }),
    ...(filter.warehouseId === undefined
      ? {}
      : {
          OR: [
            { fromWarehouseId: filter.warehouseId },
            { toWarehouseId: filter.warehouseId },
          ],
        }),
    ...(filter.variantId === undefined
      ? {}
      : { lines: { some: { variantId: filter.variantId } } }),
    ...(filter.reason === undefined ? {} : { reason: filter.reason }),
    ...(filter.status === undefined ? {} : { status: filter.status }),
    ...(filter.from === undefined && filter.to === undefined
      ? {}
      : {
          createdAt: {
            ...(filter.from === undefined ? {} : { gte: filter.from }),
            ...(filter.to === undefined ? {} : { lte: filter.to }),
          },
        }),
  };
}

function toSnapshot(row: TransferRow): StockTransferSnapshot {
  return {
    id: toId<'StockTransfer'>(row.id),
    number: Number(row.number),
    kind: row.kind,
    fromWarehouseId: toId<'Warehouse'>(row.fromWarehouseId),
    toWarehouseId: toId<'Warehouse'>(row.toWarehouseId),
    reason: row.reason,
    note: row.note,
    status: row.status,
    lines: row.lines.map(({ variantId, quantity, returned }) => ({
      variantId: toId<'Variant'>(variantId),
      quantity,
      returned,
    })),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    cancelledBy: row.cancelledBy,
    cancelledAt: row.cancelledAt,
    returnBy: row.returnBy,
    closedBy: row.closedBy,
    closedAt: row.closedAt,
    loanId: row.loanId === null ? null : toId<'StockTransfer'>(row.loanId),
    returnTransferId:
      row.returnOf === null ? null : toId<'StockTransfer'>(row.returnOf.id),
    version: row.version,
  };
}
