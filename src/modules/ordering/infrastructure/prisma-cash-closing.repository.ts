import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { Prisma } from '../../../platform/persistence/prisma/generated/client.js';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import {
  type Page,
  pageOffset,
  type PageRequest,
  toId,
} from '../../../shared-kernel/index.js';
import {
  CashClosing,
  type CashClosingId,
  type CashDay,
} from '../domain/cash-closing.js';
import {
  type CashClosingFilter,
  CashClosingRepository,
} from '../domain/cash-closing.repository.js';
import type { WarehouseId } from '../domain/order.js';

type CashClosingRow = Prisma.CashClosingGetPayload<object>;

/** `cash_closings` (DATABASE.md §8, ADR-0171): a closing is inserted once and never updated nor deleted. */
@Injectable()
export class PrismaCashClosingRepository extends CashClosingRepository {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  async insert(closing: CashClosing): Promise<boolean> {
    const c = closing.snapshot;
    // The unique day of the warehouse answers a closing at the same time as another one.
    const inserted = await this.txHost.tx.$executeRaw`
      INSERT INTO cash_closings (id, warehouse_id, business_date, expected_cash, counted_cash, difference, note,
                                 summary, closed_by, closed_at)
      VALUES (${c.id}::uuid, ${c.warehouseId}::uuid, ${c.date}::date, ${c.expectedCash}, ${c.countedCash},
              ${c.difference}, ${c.note}, ${JSON.stringify(c.summary)}::jsonb, ${c.closedBy}::uuid, ${c.closedAt})
      ON CONFLICT (warehouse_id, business_date) DO NOTHING`;
    return inserted === 1;
  }

  async findById(id: CashClosingId): Promise<CashClosing | null> {
    const row = await this.txHost.tx.cashClosing.findUnique({ where: { id } });
    return row === null ? null : toCashClosing(row);
  }

  async findByDay(
    warehouseId: WarehouseId,
    date: string,
  ): Promise<CashClosing | null> {
    const row = await this.txHost.tx.cashClosing.findUnique({
      where: {
        warehouseId_businessDate: { warehouseId, businessDate: dayOf(date) },
      },
    });
    return row === null ? null : toCashClosing(row);
  }

  async list(
    filter: CashClosingFilter,
    page: PageRequest,
  ): Promise<Page<CashClosing>> {
    const where: Prisma.CashClosingWhereInput = {
      ...(filter.warehouseId === undefined
        ? {}
        : { warehouseId: filter.warehouseId }),
      ...(filter.dateFrom === undefined && filter.dateTo === undefined
        ? {}
        : {
            businessDate: {
              gte:
                filter.dateFrom === undefined
                  ? undefined
                  : dayOf(filter.dateFrom),
              lte:
                filter.dateTo === undefined ? undefined : dayOf(filter.dateTo),
            },
          }),
    };
    const [rows, totalItems] = await Promise.all([
      this.txHost.tx.cashClosing.findMany({
        where,
        orderBy: [{ businessDate: 'desc' }, { id: 'asc' }],
        skip: pageOffset(page),
        take: page.pageSize,
      }),
      this.txHost.tx.cashClosing.count({ where }),
    ]);
    return { items: rows.map(toCashClosing), totalItems };
  }
}

/** A `date` column as Prisma takes and gives it: midnight UTC of that day. */
function dayOf(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function toCashClosing(row: CashClosingRow): CashClosing {
  return CashClosing.restore({
    id: toId<'CashClosing'>(row.id),
    warehouseId: toId<'Warehouse'>(row.warehouseId),
    date: row.businessDate.toISOString().slice(0, 10),
    // Written by insert from CashDay.
    summary: row.summary as unknown as CashDay,
    expectedCash: row.expectedCash,
    countedCash: row.countedCash,
    difference: row.difference,
    note: row.note,
    closedBy: toId<'User'>(row.closedBy),
    closedAt: row.closedAt,
  });
}
