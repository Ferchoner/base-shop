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
  type CustomerOrderFilter,
  type CustomerOrderSortField,
  type OrderLineView,
  OrderingQueries,
  type OrderSummaryView,
  type OrderView,
} from '../application/ordering.queries.js';
import type {
  CustomerId,
  OrderId,
  ShippingAddress,
  VariantOptions,
} from '../domain/order.js';
import type { PublicCode } from '../domain/public-code.js';

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

type SummaryRow = Prisma.OrderGetPayload<{ select: typeof SUMMARY_FIELDS }>;
type OrderRow = Prisma.OrderGetPayload<{ select: typeof ORDER_FIELDS }>;

/** Read models of Ordering (DATABASE.md §8), straight from `orders` and `order_lines`. */
@Injectable()
export class PrismaOrderingQueries extends OrderingQueries {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  async findOrder(id: OrderId): Promise<OrderView | null> {
    const row = await this.txHost.tx.order.findUnique({
      select: ORDER_FIELDS,
      where: { id },
    });
    return row === null ? null : toOrderView(row);
  }

  async findCustomerOrder(
    customerId: CustomerId,
    publicCode: PublicCode,
  ): Promise<OrderView | null> {
    const row = await this.txHost.tx.order.findFirst({
      select: ORDER_FIELDS,
      where: { publicCode, customerId },
    });
    return row === null ? null : toOrderView(row);
  }

  async listCustomerOrders(
    customerId: CustomerId,
    filter: CustomerOrderFilter,
    sort: readonly SortOrder<CustomerOrderSortField>[],
    page: PageRequest,
  ): Promise<Page<OrderSummaryView>> {
    const where: Prisma.OrderWhereInput = {
      customerId,
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
