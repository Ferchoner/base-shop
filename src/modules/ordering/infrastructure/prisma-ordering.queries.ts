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
import {
  type AdminOrderSummaryView,
  type AdminOrderView,
  type CustomerOrderFilter,
  type CustomerOrderSortField,
  type OrderFilter,
  type OrderLineView,
  OrderingQueries,
  type OrderSortField,
  type OrderSummaryView,
  type OrderView,
} from '../application/ordering.queries.js';
import type {
  CustomerId,
  OrderAddress,
  OrderId,
  ShippingAddress,
  VariantOptions,
} from '../domain/order.js';
import { parsePublicCode, type PublicCode } from '../domain/public-code.js';

const SUMMARY_FIELDS = {
  id: true,
  publicCode: true,
  status: true,
  customerId: true,
  contactEmail: true,
  subtotal: true,
  taxTotal: true,
  shippingCost: true,
  shippingTaxAmount: true,
  discountTotal: true,
  grandTotal: true,
  deliveryMinBusinessDays: true,
  deliveryMaxBusinessDays: true,
  placedAt: true,
  paymentDueAt: true,
  paidAt: true,
  shippedAt: true,
  deliveredAt: true,
  cancelledAt: true,
  expiredAt: true,
  refundedAt: true,
  lines: { select: { quantity: true } },
} satisfies Prisma.OrderSelect;

const ORDER_FIELDS = {
  ...SUMMARY_FIELDS,
  shippingAddress: true,
  lines: { orderBy: { lineNumber: 'asc' } },
} satisfies Prisma.OrderSelect;

const ADMIN_SUMMARY_FIELDS = {
  ...SUMMARY_FIELDS,
  orderNumber: true,
  version: true,
  anonymizedAt: true,
  shippingAddress: true,
} satisfies Prisma.OrderSelect;

const ADMIN_ORDER_FIELDS = {
  ...ADMIN_SUMMARY_FIELDS,
  lines: { orderBy: { lineNumber: 'asc' } },
  statusHistory: { orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.OrderSelect;

type SummaryRow = Prisma.OrderGetPayload<{ select: typeof SUMMARY_FIELDS }>;
type OrderRow = Prisma.OrderGetPayload<{ select: typeof ORDER_FIELDS }>;
type AdminSummaryRow = Prisma.OrderGetPayload<{
  select: typeof ADMIN_SUMMARY_FIELDS;
}>;
type AdminOrderRow = Prisma.OrderGetPayload<{
  select: typeof ADMIN_ORDER_FIELDS;
}>;

/** The largest internal number a search can ask for: the top of a PostgreSQL `bigint`. */
const MAX_ORDER_NUMBER = 9_223_372_036_854_775_807n;

/** Read models of Ordering (DATABASE.md §8), straight from `orders` and `order_lines`. */
@Injectable()
export class PrismaOrderingQueries extends OrderingQueries {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  async findOrder(id: OrderId): Promise<OrderView | null> {
    const row = await this.txHost.tx.order.findFirst({
      select: ORDER_FIELDS,
      where: { id, anonymizedAt: null },
    });
    return row === null ? null : toOrderView(row);
  }

  async findCustomerOrder(
    customerId: CustomerId,
    publicCode: PublicCode,
  ): Promise<OrderView | null> {
    const row = await this.txHost.tx.order.findFirst({
      select: ORDER_FIELDS,
      where: { publicCode, customerId, anonymizedAt: null },
    });
    return row === null ? null : toOrderView(row);
  }

  async findGuestOrder(
    publicCode: PublicCode,
    contactEmail: string,
  ): Promise<OrderView | null> {
    const row = await this.txHost.tx.order.findFirst({
      select: ORDER_FIELDS,
      where: { publicCode, contactEmail, customerId: null },
    });
    return row === null ? null : toOrderView(row);
  }

  async findAdminOrder(id: OrderId): Promise<AdminOrderView | null> {
    const row = await this.txHost.tx.order.findUnique({
      select: ADMIN_ORDER_FIELDS,
      where: { id },
    });
    return row === null ? null : toAdminOrderView(row);
  }

  async listOrders(
    filter: OrderFilter,
    sort: readonly SortOrder<OrderSortField>[],
    page: PageRequest,
  ): Promise<Page<AdminOrderSummaryView>> {
    const where: Prisma.OrderWhereInput = {
      AND: [
        filter.q === undefined ? {} : { OR: searchOf(filter.q) },
        filter.status === undefined
          ? {}
          : { status: { in: [...filter.status] } },
        filter.customerId === undefined
          ? {}
          : { customerId: filter.customerId },
        filter.guest === undefined
          ? {}
          : { customerId: filter.guest ? null : { not: null } },
        filter.placedFrom === undefined && filter.placedTo === undefined
          ? {}
          : { placedAt: { gte: filter.placedFrom, lte: filter.placedTo } },
        filter.hasPendingRefund === undefined
          ? {}
          : filter.hasPendingRefund
            ? PENDING_REFUND
            : { NOT: PENDING_REFUND },
      ],
    };
    const [rows, totalItems] = await Promise.all([
      this.txHost.tx.order.findMany({
        select: ADMIN_SUMMARY_FIELDS,
        where,
        orderBy: [
          ...sort.map(({ field, direction }) => ({ [field]: direction })),
          { id: 'asc' as const },
        ],
        skip: pageOffset(page),
        take: page.pageSize,
      }),
      this.txHost.tx.order.count({ where }),
    ]);
    return { items: rows.map(toAdminSummaryView), totalItems };
  }

  async listCustomerOrders(
    customerId: CustomerId,
    filter: CustomerOrderFilter,
    sort: readonly SortOrder<CustomerOrderSortField>[],
    page: PageRequest,
  ): Promise<Page<OrderSummaryView>> {
    const where: Prisma.OrderWhereInput = {
      customerId,
      anonymizedAt: null,
      ...(filter.status === undefined
        ? {}
        : { status: { in: [...filter.status] } }),
      ...(filter.placedFrom === undefined && filter.placedTo === undefined
        ? {}
        : { placedAt: { gte: filter.placedFrom, lte: filter.placedTo } }),
    };
    const [rows, totalItems] = await Promise.all([
      this.txHost.tx.order.findMany({
        select: SUMMARY_FIELDS,
        where,
        orderBy: [
          ...sort.map(({ field, direction }) => ({ [field]: direction })),
          { id: 'asc' as const },
        ],
        skip: pageOffset(page),
        take: page.pageSize,
      }),
      this.txHost.tx.order.count({ where }),
    ]);
    return { items: rows.map(toSummaryView), totalItems };
  }
}

/** Cancelled with a captured payment and no refund yet (ADR-0051, ADR-0133). */
const PENDING_REFUND = {
  status: 'CANCELLED',
  paidAt: { not: null },
} satisfies Prisma.OrderWhereInput;

/**
 * What `q` matches: the internal number and the public code exactly, with or without the dash and in any
 * case, and part of the contact email in any case (ADR-0133).
 */
function searchOf(q: string): Prisma.OrderWhereInput[] {
  const text = q.trim();
  const code = parsePublicCode(text);
  const number = /^[0-9]{1,19}$/.test(text) ? BigInt(text) : null;
  return [
    ...(number !== null && number <= MAX_ORDER_NUMBER
      ? [{ orderNumber: number }]
      : []),
    ...(code === null ? [] : [{ publicCode: code }]),
    { contactEmail: { contains: text, mode: 'insensitive' as const } },
  ];
}

function toSummaryView(row: SummaryRow): OrderSummaryView {
  const money = (amount: number) => Money.of(amount, 'MXN');
  return {
    id: toId<'Order'>(row.id),
    publicCode: row.publicCode as PublicCode,
    status: row.status,
    customerId: row.customerId === null ? null : toId<'User'>(row.customerId),
    contactEmail: row.contactEmail,
    totals: {
      subtotal: money(row.subtotal),
      taxTotal: money(row.taxTotal),
      shippingCost: money(row.shippingCost),
      shippingTaxAmount: money(row.shippingTaxAmount),
      discountTotal: money(row.discountTotal),
      grandTotal: money(row.grandTotal),
    },
    itemCount: row.lines.reduce((sum, { quantity }) => sum + quantity, 0),
    deliveryMinBusinessDays: row.deliveryMinBusinessDays,
    deliveryMaxBusinessDays: row.deliveryMaxBusinessDays,
    placedAt: row.placedAt,
    paymentDueAt: row.status === 'PENDING_PAYMENT' ? row.paymentDueAt : null,
    paidAt: row.paidAt,
    shippedAt: row.shippedAt,
    deliveredAt: row.deliveredAt,
    cancelledAt: row.cancelledAt,
    expiredAt: row.expiredAt,
    refundedAt: row.refundedAt,
  };
}

function toOrderView(row: OrderRow): OrderView {
  return {
    ...toSummaryView(row),
    lines: row.lines.map((line): OrderLineView => ({
      id: toId<'OrderLine'>(line.id),
      lineNumber: line.lineNumber,
      sku: line.sku,
      productName: line.productName,
      variantOptions: line.variantOptions as VariantOptions,
      unitPrice: Money.of(line.unitPrice, 'MXN'),
      quantity: line.quantity,
      taxRateBp: line.taxRateBp,
      taxAmount: Money.of(line.taxAmount, 'MXN'),
      lineTotal: Money.of(line.lineTotal, 'MXN'),
    })),
    // Written by PrismaOrderRepository from ShippingAddress.
    shippingAddress: row.shippingAddress as unknown as ShippingAddress,
  };
}

function toAdminSummaryView(row: AdminSummaryRow): AdminOrderSummaryView {
  return {
    ...toSummaryView(row),
    orderNumber: Number(row.orderNumber),
    version: row.version,
    anonymizedAt: row.anonymizedAt,
    // Written by PrismaOrderRepository from ShippingAddress, and once anonymized.
    shippingAddress: row.shippingAddress as unknown as OrderAddress,
  };
}

function toAdminOrderView(row: AdminOrderRow): AdminOrderView {
  return {
    ...toAdminSummaryView(row),
    lines: toOrderView(row).lines,
    statusHistory: row.statusHistory.map((entry) => ({
      fromStatus: entry.fromStatus,
      toStatus: entry.toStatus,
      actorId: entry.actorId,
      reason: entry.reason,
      occurredAt: entry.occurredAt,
    })),
  };
}
