import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { Prisma } from '../../../platform/persistence/prisma/generated/client.js';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import {
  type Page,
  pageOffset,
  type PageRequest,
  type SortOrder,
  toId,
} from '../../../shared-kernel/index.js';
import {
  InventoryQueries,
  type MovementFilter,
  type MovementPosition,
  type StockFilter,
  type WarehouseView,
} from '../application/inventory.queries.js';
import type {
  StockItemId,
  StockLevel,
  StockMovement,
} from '../domain/stock.js';
import type { WarehouseAddress, WarehouseId } from '../domain/warehouse.js';

interface StockRow {
  id: string;
  variant_id: string;
  warehouse_id: string;
  on_hand: number;
  reserved: number;
  updated_at: Date;
}

const SORT_COLUMNS = {
  available: Prisma.sql`(on_hand - reserved)`,
  updatedAt: Prisma.sql`updated_at`,
} as const;

function toStockLevel(row: StockRow): StockLevel {
  return {
    id: toId<'StockItem'>(row.id),
    variantId: toId<'Variant'>(row.variant_id),
    warehouseId: toId<'Warehouse'>(row.warehouse_id),
    onHand: row.on_hand,
    reserved: row.reserved,
    updatedAt: row.updated_at,
  };
}

/** `WHERE` of a stock filter. */
function stockWhere(filter: StockFilter): Prisma.Sql {
  const conditions = [
    filter.variantIds === undefined
      ? null
      : Prisma.sql`variant_id = ANY(${[...filter.variantIds]}::uuid[])`,
    filter.warehouseId === undefined
      ? null
      : Prisma.sql`warehouse_id = ${filter.warehouseId}::uuid`,
    filter.availableMax === undefined
      ? null
      : Prisma.sql`on_hand - reserved <= ${filter.availableMax}::int`,
  ].filter((condition) => condition !== null);
  return conditions.length === 0
    ? Prisma.empty
    : Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
}

/** Read models of Inventory, from its own tables only (ADR-0127). */
@Injectable()
export class PrismaInventoryQueries extends InventoryQueries {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  async listWarehouses(): Promise<WarehouseView[]> {
    const rows = await this.txHost.tx.warehouse.findMany({
      orderBy: { code: 'asc' },
    });
    return rows.map(toWarehouseView);
  }

  async findWarehouse(id: WarehouseId): Promise<WarehouseView | null> {
    const row = await this.txHost.tx.warehouse.findUnique({ where: { id } });
    return row === null ? null : toWarehouseView(row);
  }

  async pageOfStock(
    filter: StockFilter,
    sort: readonly SortOrder<'available' | 'updatedAt'>[],
    page: PageRequest,
  ): Promise<Page<StockLevel>> {
    const where = stockWhere(filter);
    const order = Prisma.join(
      [
        ...sort.map(
          ({ field, direction }) =>
            Prisma.sql`${SORT_COLUMNS[field]} ${Prisma.raw(direction === 'asc' ? 'ASC' : 'DESC')}`,
        ),
        Prisma.sql`id ASC`,
      ],
      ', ',
    );
    const [rows, [{ count }]] = await Promise.all([
      this.txHost.tx.$queryRaw<StockRow[]>`
        SELECT id, variant_id, warehouse_id, on_hand, reserved, updated_at
          FROM stock_items ${where}
         ORDER BY ${order}
         LIMIT ${page.pageSize} OFFSET ${pageOffset(page)}`,
      this.txHost.tx.$queryRaw<{ count: number }[]>`
        SELECT count(*)::int AS count FROM stock_items ${where}`,
    ]);
    return { items: rows.map(toStockLevel), totalItems: count };
  }

  async allStock(filter: StockFilter): Promise<StockLevel[]> {
    const rows = await this.txHost.tx.$queryRaw<StockRow[]>`
      SELECT id, variant_id, warehouse_id, on_hand, reserved, updated_at
        FROM stock_items ${stockWhere(filter)}`;
    return rows.map(toStockLevel);
  }

  async findStock(id: StockItemId): Promise<StockLevel | null> {
    const row = await this.txHost.tx.stockItem.findUnique({ where: { id } });
    return row === null
      ? null
      : toStockLevel({
          id: row.id,
          variant_id: row.variantId,
          warehouse_id: row.warehouseId,
          on_hand: row.onHand,
          reserved: row.reserved,
          updated_at: row.updatedAt,
        });
  }

  async listMovements(
    stockItemId: StockItemId,
    filter: MovementFilter,
    position: MovementPosition | null,
    limit: number,
  ): Promise<StockMovement[]> {
    const rows = await this.txHost.tx.stockMovement.findMany({
      where: {
        stockItemId,
        ...(filter.types === undefined
          ? {}
          : { type: { in: [...filter.types] } }),
        ...(filter.from === undefined && filter.to === undefined
          ? {}
          : { createdAt: { gte: filter.from, lte: filter.to } }),
        ...(position === null
          ? {}
          : {
              OR: [
                { createdAt: { lt: position.createdAt } },
                { createdAt: position.createdAt, id: { lt: position.id } },
              ],
            }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    return rows.map((row) => ({
      id: toId<'StockMovement'>(row.id),
      stockItemId: toId<'StockItem'>(row.stockItemId),
      type: row.type,
      quantity: row.quantity,
      onHandAfter: row.onHandAfter,
      reasonCode: row.reasonCode,
      note: row.note,
      orderId: row.orderId,
      orderLineId: row.orderLineId,
      actorId: row.actorId,
      createdAt: row.createdAt,
    }));
  }
}

function toWarehouseView(row: {
  id: string;
  code: string;
  name: string;
  address: unknown;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: Date;
  updatedAt: Date;
}): WarehouseView {
  return {
    id: toId<'Warehouse'>(row.id),
    code: row.code,
    name: row.name,
    address: (row.address ?? null) as WarehouseAddress | null,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
