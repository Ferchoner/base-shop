import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { Prisma } from '../../../platform/persistence/prisma/generated/client.js';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import {
  type Page,
  type PageRequest,
  pageOffset,
  toId,
  VersionConflictError,
} from '../../../shared-kernel/index.js';
import {
  type CountListFilter,
  CountQueries,
  type CountRecord,
  type CountSummary,
} from '../application/count.queries.js';
import type { VariantId } from '../domain/stock.js';
import {
  type CountFilter,
  type CountLine,
  formatCountFolio,
  type OpenCountLine,
  StockCount,
  type StockCountId,
  type StockCountSnapshot,
} from '../domain/stock-count.js';
import {
  type CountCapture,
  type LineOutcome,
  type NewCountLine,
  StockCountRepository,
} from '../domain/stock-count.repository.js';

/** How many lines a sheet has and how many are counted, read with it. */
const WITH_COUNTS = {
  _count: {
    select: {
      lines: true,
    },
  },
} satisfies Prisma.StockCountInclude;

type CountRow = Prisma.StockCountGetPayload<object>;

/**
 * Count sheets in PostgreSQL (DATABASE.md §6.8, ADR-0173). The number of the folio comes from the sequence of
 * `number`, like transfers (ADR-0172). A variant is in one open sheet per warehouse: the lines are added with
 * `ON CONFLICT … DO NOTHING` over the partial unique index, so a sheet being opened at the same time waits for the
 * other one and then finds its lines, in variant order so two never wait for each other in a circle. Every change
 * locks the sheet first. Dates come from the application, never from the database clock.
 */
@Injectable()
export class PrismaStockCountRepository extends StockCountRepository {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  async insert(
    count: StockCount,
    lines: readonly NewCountLine[],
  ): Promise<{ number: number } | { conflicts: OpenCountLine[] }> {
    const c = count.snapshot;
    const tx = this.txHost.tx;
    const { number } = await tx.stockCount.create({
      select: { number: true },
      data: {
        id: c.id,
        warehouseId: c.warehouseId,
        filter: { ...c.filter } as Prisma.InputJsonObject,
        note: c.note,
        status: c.status,
        createdBy: c.createdBy,
        createdAt: c.createdAt,
        version: c.version,
        updatedAt: c.createdAt,
      },
    });
    const inserted = await tx.$queryRaw<{ variant_id: string }[]>`
      INSERT INTO stock_count_lines (count_id, variant_id, warehouse_id, position, location)
      SELECT ${c.id}::uuid, row.variant_id, ${c.warehouseId}::uuid, row.position, row.location
        FROM unnest(
               ${lines.map(({ variantId }) => variantId)}::uuid[],
               ${lines.map((_, i) => i + 1)}::int[],
               ${lines.map(({ location }) => location)}::varchar[]
             ) AS row(variant_id, position, location)
       ORDER BY row.variant_id
      ON CONFLICT (warehouse_id, variant_id) WHERE open DO NOTHING
   RETURNING variant_id`;
    if (inserted.length === lines.length) return { number: Number(number) };
    const saved = new Set(inserted.map(({ variant_id }) => variant_id));
    return {
      conflicts: await this.openLinesOf(
        count,
        lines
          .map(({ variantId }) => variantId)
          .filter((variantId) => !saved.has(variantId)),
      ),
    };
  }

  async lock(id: StockCountId): Promise<StockCount | null> {
    const tx = this.txHost.tx;
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM stock_counts WHERE id = ${id}::uuid FOR UPDATE`;
    if (locked.length === 0) return null;
    const row = await tx.stockCount.findUniqueOrThrow({ where: { id } });
    return StockCount.restore(toSnapshot(row));
  }

  async hasLine(id: StockCountId, variantId: VariantId): Promise<boolean> {
    const line = await this.txHost.tx.stockCountLine.findUnique({
      select: { variantId: true },
      where: { countId_variantId: { countId: id, variantId } },
    });
    return line !== null;
  }

  async addLine(
    count: StockCount,
    line: NewCountLine,
  ): Promise<OpenCountLine | null> {
    const c = count.snapshot;
    // The sheet is locked, so the next position is its own.
    const inserted = await this.txHost.tx.$queryRaw<{ variant_id: string }[]>`
      INSERT INTO stock_count_lines (count_id, variant_id, warehouse_id, position, location)
      SELECT ${c.id}::uuid, ${line.variantId}::uuid, ${c.warehouseId}::uuid,
             coalesce(max(position), 0) + 1, ${line.location}::varchar
        FROM stock_count_lines WHERE count_id = ${c.id}::uuid
      ON CONFLICT (warehouse_id, variant_id) WHERE open DO NOTHING
   RETURNING variant_id`;
    if (inserted.length > 0) return null;
    const [other] = await this.openLinesOf(count, [line.variantId]);
    if (other === undefined) {
      throw new Error('A line not added is in another open sheet');
    }
    return other;
  }

  async capture(
    id: StockCountId,
    variantId: VariantId,
    capture: CountCapture,
  ): Promise<void> {
    await this.txHost.tx.stockCountLine.update({
      where: { countId_variantId: { countId: id, variantId } },
      data: { ...capture, recount: false },
    });
  }

  async recount(id: StockCountId, variantId: VariantId): Promise<void> {
    await this.txHost.tx.stockCountLine.update({
      where: { countId_variantId: { countId: id, variantId } },
      data: {
        counted: null,
        expected: null,
        countedBy: null,
        countedAt: null,
        recount: true,
      },
    });
  }

  async stockOf(
    count: StockCount,
    variantId: VariantId,
  ): Promise<{ onHand: number; location: string | null }> {
    const item = await this.txHost.tx.stockItem.findUnique({
      select: { onHand: true, location: true },
      where: {
        variantId_warehouseId: {
          variantId,
          warehouseId: count.snapshot.warehouseId,
        },
      },
    });
    return item ?? { onHand: 0, location: null };
  }

  async countedLines(
    id: StockCountId,
  ): Promise<{ variantId: VariantId; difference: number }[]> {
    const rows = await this.txHost.tx.stockCountLine.findMany({
      select: { variantId: true, counted: true, expected: true },
      where: { countId: id, counted: { not: null } },
      orderBy: { position: 'asc' },
    });
    return rows.map(({ variantId, counted, expected }) => ({
      variantId: toId<'Variant'>(variantId),
      // The CHECK of the table keeps both or neither.
      difference: (counted ?? 0) - (expected ?? 0),
    }));
  }

  async closeLines(
    id: StockCountId,
    outcomes: readonly LineOutcome[] | null,
  ): Promise<number> {
    const tx = this.txHost.tx;
    if (outcomes === null) {
      await tx.stockCountLine.updateMany({
        where: { countId: id },
        data: { open: false },
      });
      return 0;
    }
    if (outcomes.length > 0) {
      await tx.$executeRaw`
        UPDATE stock_count_lines AS line
           SET open = false, outcome = given.outcome::stock_count_outcome, movement_id = given.movement_id
          FROM unnest(
                 ${outcomes.map(({ variantId }) => variantId)}::uuid[],
                 ${outcomes.map(({ outcome }) => outcome)}::text[],
                 ${outcomes.map(({ movementId }) => movementId)}::uuid[]
               ) AS given(variant_id, outcome, movement_id)
         WHERE line.count_id = ${id}::uuid AND line.variant_id = given.variant_id`;
    }
    const { count } = await tx.stockCountLine.updateMany({
      where: { countId: id, open: true },
      data: { open: false, outcome: 'NOT_COUNTED' },
    });
    return count;
  }

  async save(count: StockCount, now: Date): Promise<void> {
    const c = count.snapshot;
    const tx = this.txHost.tx;
    const { count: saved } = await tx.stockCount.updateMany({
      where: { id: c.id, version: c.version },
      data: {
        status: c.status,
        closedBy: c.closedBy,
        closedAt: c.closedAt,
        version: { increment: 1 },
        updatedAt: now,
      },
    });
    if (saved === 0) {
      const current = await tx.stockCount.findUnique({
        select: { version: true },
        where: { id: c.id },
      });
      throw new VersionConflictError(current?.version ?? c.version);
    }
  }

  /** The other open sheets of the warehouse that have these variants. */
  private async openLinesOf(
    count: StockCount,
    variantIds: readonly VariantId[],
  ): Promise<OpenCountLine[]> {
    const c = count.snapshot;
    const rows = await this.txHost.tx.stockCountLine.findMany({
      select: {
        variantId: true,
        count: { select: { id: true, number: true } },
      },
      where: {
        warehouseId: c.warehouseId,
        open: true,
        variantId: { in: [...variantIds] },
        countId: { not: c.id },
      },
      orderBy: { variantId: 'asc' },
    });
    return rows.map(({ variantId, count: other }) => ({
      variantId: toId<'Variant'>(variantId),
      countId: toId<'StockCount'>(other.id),
      folio: formatCountFolio(Number(other.number)),
    }));
  }
}

/** Read models of count sheets (ADR-0173), in the active transaction when there is one. */
@Injectable()
export class PrismaCountQueries extends CountQueries {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  async pageOfCounts(
    filter: CountListFilter,
    page: PageRequest,
  ): Promise<Page<CountSummary>> {
    const where: Prisma.StockCountWhereInput = {
      ...(filter.warehouseId === undefined
        ? {}
        : { warehouseId: filter.warehouseId }),
      ...(filter.status === undefined ? {} : { status: filter.status }),
    };
    const tx = this.txHost.tx;
    const [rows, totalItems] = await Promise.all([
      tx.stockCount.findMany({
        where,
        include: WITH_COUNTS,
        orderBy: { number: 'desc' },
        skip: pageOffset(page),
        take: page.pageSize,
      }),
      tx.stockCount.count({ where }),
    ]);
    const counted = await this.countedOf(rows.map(({ id }) => id));
    return {
      items: rows.map((row) => ({
        ...toSnapshot(row),
        lineCount: row._count.lines,
        countedCount: counted.get(row.id) ?? 0,
      })),
      totalItems,
    };
  }

  async findCount(id: StockCountId): Promise<CountRecord | null> {
    const row = await this.txHost.tx.stockCount.findUnique({
      where: { id },
      include: { lines: { orderBy: { position: 'asc' } } },
    });
    if (row === null) return null;
    const lines: CountLine[] = row.lines.map((line) => ({
      variantId: toId<'Variant'>(line.variantId),
      position: line.position,
      location: line.location,
      counted: line.counted,
      expected: line.expected,
      countedBy: line.countedBy,
      countedAt: line.countedAt,
      recount: line.recount,
      outcome: line.outcome,
      movementId:
        line.movementId === null
          ? null
          : toId<'StockMovement'>(line.movementId),
    }));
    return {
      ...toSnapshot(row),
      lineCount: lines.length,
      countedCount: lines.filter(({ counted }) => counted !== null).length,
      lines,
    };
  }

  /** How many lines of each of these sheets are counted. */
  private async countedOf(
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await this.txHost.tx.stockCountLine.groupBy({
      by: ['countId'],
      where: { countId: { in: [...ids] }, counted: { not: null } },
      _count: { _all: true },
    });
    return new Map(rows.map(({ countId, _count }) => [countId, _count._all]));
  }
}

function toSnapshot(row: CountRow): StockCountSnapshot {
  return {
    id: toId<'StockCount'>(row.id),
    number: Number(row.number),
    warehouseId: toId<'Warehouse'>(row.warehouseId),
    filter: row.filter as CountFilter,
    note: row.note,
    status: row.status,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    closedBy: row.closedBy,
    closedAt: row.closedAt,
    version: row.version,
  };
}
