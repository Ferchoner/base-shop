import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { Prisma } from '../../../platform/persistence/prisma/generated/client.js';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import {
  Money,
  type Page,
  pageOffset,
  type PageRequest,
  type SortOrder,
  toId,
} from '../../../shared-kernel/index.js';
import { formatFolio, parseFolio } from '../domain/folio.js';
import type { WorkOrderId } from '../domain/work-order.js';
import {
  type WorkOrderFilter,
  WorkOrderQueries,
  type WorkOrderSortField,
  type WorkOrderSummaryView,
  type WorkOrderView,
} from '../application/work-orders.queries.js';

const SUMMARY_FIELDS = {
  id: true,
  number: true,
  status: true,
  customerName: true,
  customerPhone: true,
  equipmentType: true,
  equipmentBrand: true,
  equipmentModel: true,
  serialNumber: true,
  warehouseId: true,
  technicianId: true,
  receivedAt: true,
  closedAt: true,
} satisfies Prisma.WorkOrderSelect;

type SummaryRow = Prisma.WorkOrderGetPayload<{ select: typeof SUMMARY_FIELDS }>;

type WorkOrderRow = Prisma.WorkOrderGetPayload<{
  include: { statusHistory: true; sales: true };
}>;

/** The column of each sort field: the folio sorts by its number. */
const SORT_COLUMNS: Readonly<Record<WorkOrderSortField, string>> = {
  receivedAt: 'receivedAt',
  folio: 'number',
};

/** Read models of Work Orders in PostgreSQL (DATABASE.md §17). */
@Injectable()
export class PrismaWorkOrderQueries extends WorkOrderQueries {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  async findWorkOrder(id: WorkOrderId): Promise<WorkOrderView | null> {
    const row = await this.txHost.tx.workOrder.findUnique({
      where: { id },
      include: {
        statusHistory: { orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] },
        sales: { orderBy: [{ linkedAt: 'asc' }, { orderId: 'asc' }] },
      },
    });
    return row === null ? null : toView(row);
  }

  async listWorkOrders(
    filter: WorkOrderFilter,
    sort: readonly SortOrder<WorkOrderSortField>[],
    page: PageRequest,
  ): Promise<Page<WorkOrderSummaryView>> {
    const where: Prisma.WorkOrderWhereInput = {
      AND: [
        filter.q === undefined ? {} : { OR: searchOf(filter.q) },
        filter.status === undefined
          ? {}
          : { status: { in: [...filter.status] } },
        filter.warehouseId === undefined
          ? {}
          : { warehouseId: filter.warehouseId },
        filter.technicianId === undefined
          ? {}
          : { technicianId: filter.technicianId },
        filter.customerId === undefined
          ? {}
          : { customerId: filter.customerId },
        filter.receivedFrom === undefined && filter.receivedTo === undefined
          ? {}
          : {
              receivedAt: { gte: filter.receivedFrom, lte: filter.receivedTo },
            },
      ],
    };
    const [rows, totalItems] = await Promise.all([
      this.txHost.tx.workOrder.findMany({
        select: SUMMARY_FIELDS,
        where,
        orderBy: [
          ...sort.map(({ field, direction }) => ({
            [SORT_COLUMNS[field]]: direction,
          })),
          { id: 'asc' as const },
        ],
        skip: pageOffset(page),
        take: page.pageSize,
      }),
      this.txHost.tx.workOrder.count({ where }),
    ]);
    return { items: rows.map(toSummaryView), totalItems };
  }
}

/**
 * What `q` matches (UC-WRK-02): the folio exactly, as `OT-000123`, `ot-123` or `123`; part of the phone, written
 * with spaces, dashes or parentheses or without them; and part of the name of the customer or of the serial
 * number, in any case.
 */
function searchOf(q: string): Prisma.WorkOrderWhereInput[] {
  const text = q.trim();
  const number = parseFolio(text);
  const digits = text.replace(/[\s()-]/g, '');
  return [
    ...(number === null ? [] : [{ number: BigInt(number) }]),
    ...(/^[0-9]{1,10}$/.test(digits)
      ? [{ customerPhone: { contains: digits } }]
      : []),
    { customerName: { contains: text, mode: 'insensitive' as const } },
    { serialNumber: { contains: text, mode: 'insensitive' as const } },
  ];
}

function toSummaryView(row: SummaryRow): WorkOrderSummaryView {
  return {
    id: toId<'WorkOrder'>(row.id),
    folio: formatFolio(Number(row.number)),
    status: row.status,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    equipmentType: row.equipmentType,
    equipmentBrand: row.equipmentBrand,
    equipmentModel: row.equipmentModel,
    serialNumber: row.serialNumber,
    warehouseId: toId<'Warehouse'>(row.warehouseId),
    technicianId:
      row.technicianId === null ? null : toId<'User'>(row.technicianId),
    receivedAt: row.receivedAt,
    closedAt: row.closedAt,
  };
}

function toView(row: WorkOrderRow): WorkOrderView {
  return {
    ...toSummaryView(row),
    customerId: row.customerId === null ? null : toId<'User'>(row.customerId),
    customerEmail: row.customerEmail,
    accessories: row.accessories,
    equipmentCondition: row.equipmentCondition,
    reportedFault: row.reportedFault,
    diagnosis: row.diagnosis,
    workPerformed: row.workPerformed,
    estimatedCost:
      row.estimatedCost === null ? null : Money.of(row.estimatedCost, 'MXN'),
    receivedBy: toId<'User'>(row.receivedBy),
    version: row.version,
    statusHistory: row.statusHistory.map((entry) => ({
      fromStatus: entry.fromStatus,
      toStatus: entry.toStatus,
      actorId: toId<'User'>(entry.actorId),
      note: entry.note,
      occurredAt: entry.occurredAt,
    })),
    sales: row.sales.map((sale) => ({
      orderId: toId<'Order'>(sale.orderId),
      linkedBy: toId<'User'>(sale.linkedBy),
      linkedAt: sale.linkedAt,
    })),
  };
}
