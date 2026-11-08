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

type TransferRow = Prisma.StockTransferGetPayload<{
  include: { lines: true };
}>;

/** The lines of a transfer, in the order of their variants. */
const WITH_LINES = { lines: { orderBy: { variantId: 'asc' as const } } };

/**
 * Transfers between warehouses in PostgreSQL (DATABASE.md §6.7, ADR-0172). The number of the folio comes from the
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
        fromWarehouseId: t.fromWarehouseId,
        toWarehouseId: t.toWarehouseId,
        reason: t.reason,
        note: t.note,
        status: t.status,
        createdBy: t.createdBy,
        createdAt: t.createdAt,
        cancelledBy: t.cancelledBy,
        cancelledAt: t.cancelledAt,
        version: t.version,
        updatedAt: now,
        lines: {
          create: t.lines.map(({ variantId, quantity }) => ({
            variantId,
            quantity,
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
    const { count } = await this.txHost.tx.stockTransfer.updateMany({
      where: { id: t.id, version: t.version },
      data: {
        status: t.status,
        cancelledBy: t.cancelledBy,
        cancelledAt: t.cancelledAt,
        version: { increment: 1 },
        updatedAt: now,
      },
    });
    if (count === 0) {
      const current = await this.txHost.tx.stockTransfer.findUnique({
        select: { version: true },
        where: { id: t.id },
      });
      throw new VersionConflictError(current?.version ?? t.version);
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
  return {
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
    fromWarehouseId: toId<'Warehouse'>(row.fromWarehouseId),
    toWarehouseId: toId<'Warehouse'>(row.toWarehouseId),
    reason: row.reason,
    note: row.note,
    status: row.status,
    lines: row.lines.map(({ variantId, quantity }) => ({
      variantId: toId<'Variant'>(variantId),
      quantity,
    })),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    cancelledBy: row.cancelledBy,
    cancelledAt: row.cancelledAt,
    version: row.version,
  };
}
