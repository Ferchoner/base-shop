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
import {
  type CustomerId,
  type OrderAddress,
  type OrderId,
  type ShippingAddress,
  type VariantOptions,
  withoutIdentifyingFields,
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
  channel: true,
  placedBy: true,
  warehouseId: true,
  anonymizedAt: true,
  blockedAt: true,
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
      where: { id, anonymizedAt: null, blockedAt: null },
    });
    return row === null ? null : toOrderView(row);
  }

  async findCustomerOrder(
    customerId: CustomerId,
    publicCode: PublicCode,
  ): Promise<OrderView | null> {
    const row = await this.txHost.tx.order.findFirst({
      select: ORDER_FIELDS,
      where: { publicCode, customerId, anonymizedAt: null, blockedAt: null },
    });
    return row === null ? null : toOrderView(row);
  }

  async findGuestOrder(
    publicCode: PublicCode,
    contactEmail: string,
  ): Promise<OrderView | null> {
    const row = await this.txHost.tx.order.findFirst({
      select: ORDER_FIELDS,
      where: { publicCode, contactEmail, customerId: null, blockedAt: null },
    });
    return row === null ? null : toOrderView(row);
  }

  async hasGuestOrders(contactEmail: string): Promise<boolean> {
    const row = await this.txHost.tx.order.findFirst({
      select: { id: true },
      where: { contactEmail, customerId: null, blockedAt: null },
    });
    return row !== null;
  }

  async hasOpenOrders(customerId: CustomerId): Promise<boolean> {
    const row = await this.txHost.tx.order.findFirst({
      select: { id: true },
      // An anonymized order always concluded first (ADR-0145).
      where: { customerId, concludedAt: null },
    });
    return row !== null;
  }

  async listGuestOrders(
    contactEmail: string,
    limit: number,
  ): Promise<readonly OrderSummaryView[]> {
    const rows = await this.txHost.tx.order.findMany({
      select: SUMMARY_FIELDS,
      where: { contactEmail, customerId: null, blockedAt: null },
      orderBy: [{ placedAt: 'desc' }, { id: 'asc' }],
      take: limit,
    });
    return rows.map(toSummaryView);
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
        filter.channel === undefined ? {} : { channel: filter.channel },
        filter.placedBy === undefined ? {} : { placedBy: filter.placedBy },
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
      blockedAt: null,
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
    // Never by the email of a blocked order: it is hidden (ADR-0070).
    {
      contactEmail: { contains: text, mode: 'insensitive' as const },
      blockedAt: null,
    },
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
  // Written by PrismaOrderRepository from ShippingAddress, and once anonymized.
  const address = row.shippingAddress as unknown as OrderAddress;
  const blocked = row.blockedAt !== null;
  return {
    ...toSummaryView(row),
    // Blocked, it shows only what an anonymized one keeps (ADR-0070).
    contactEmail: blocked ? null : row.contactEmail,
    orderNumber: Number(row.orderNumber),
    version: row.version,
    channel: row.channel,
    placedBy: row.placedBy === null ? null : toId<'User'>(row.placedBy),
    warehouseId:
      row.warehouseId === null ? null : toId<'Warehouse'>(row.warehouseId),
    anonymizedAt: row.anonymizedAt,
    blockedAt: row.blockedAt,
    shippingAddress: blocked ? withoutIdentifyingFields(address) : address,
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
