import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { Prisma } from '../../../platform/persistence/prisma/generated/client.js';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import {
  type Currency,
  Money,
  type Page,
  pageOffset,
  type PageRequest,
  type SortOrder,
  toId,
} from '../../../shared-kernel/index.js';
import {
  type AdminPaymentView,
  type PaymentFilter,
  type PaymentSettingsView,
  PaymentsQueries,
  type PaymentSortField,
  type PaymentView,
} from '../application/payments.queries.js';
import type { OrderId, PaymentId } from '../domain/payment.js';

const PAYMENT_FIELDS = {
  include: {
    attempts: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
    refunds: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
  },
} satisfies Prisma.PaymentDefaultArgs;

type PaymentRow = Prisma.PaymentGetPayload<typeof PAYMENT_FIELDS>;

/** Read models of Payments (DATABASE.md §9), straight from `payments`, `payment_attempts` and `refunds`. */
@Injectable()
export class PrismaPaymentsQueries extends PaymentsQueries {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  async paymentsOf(
    orderIds: readonly OrderId[],
  ): Promise<ReadonlyMap<OrderId, PaymentView>> {
    if (orderIds.length === 0) return new Map();
    const rows = await this.txHost.tx.payment.findMany({
      ...PAYMENT_FIELDS,
      where: { orderId: { in: [...orderIds] } },
    });
    return new Map(
      rows.map((row) => [toId<'Order'>(row.orderId), toPaymentView(row)]),
    );
  }

  async findSettings(): Promise<PaymentSettingsView> {
    const row = await this.txHost.tx.paymentSettings.findFirst({
      select: { manualPaymentsEnabled: true, version: true, updatedAt: true },
    });
    // Its migration creates the only row, and nothing deletes it.
    if (row === null) throw new Error('payment_settings has no row');
    return row;
  }

  async findPayment(id: PaymentId): Promise<AdminPaymentView | null> {
    const row = await this.txHost.tx.payment.findUnique({
      ...PAYMENT_FIELDS,
      where: { id },
    });
    return row === null ? null : toAdminPaymentView(row);
  }

  async listPayments(
    filter: PaymentFilter,
    sort: readonly SortOrder<PaymentSortField>[],
    page: PageRequest,
  ): Promise<Page<AdminPaymentView>> {
    const where: Prisma.PaymentWhereInput = {
      ...(filter.status === undefined
        ? {}
        : { status: { in: [...filter.status] } }),
      ...(filter.provider === undefined
        ? {}
        : { provider: { in: [...filter.provider] } }),
      ...(filter.orderId === undefined ? {} : { orderId: filter.orderId }),
      ...(filter.capturedFrom === undefined && filter.capturedTo === undefined
        ? {}
        : {
            capturedAt: { gte: filter.capturedFrom, lte: filter.capturedTo },
          }),
    };
    const [rows, totalItems] = await Promise.all([
      this.txHost.tx.payment.findMany({
        ...PAYMENT_FIELDS,
        where,
        orderBy: [
          ...sort.map(({ field, direction }) => ({ [field]: direction })),
          { id: 'asc' as const },
        ],
        skip: pageOffset(page),
        take: page.pageSize,
      }),
      this.txHost.tx.payment.count({ where }),
    ]);
    return { items: rows.map(toAdminPaymentView), totalItems };
  }
}

function toPaymentView(row: PaymentRow): PaymentView {
  const money = (amount: number) => Money.of(amount, row.currency as Currency);
  return {
    id: toId<'Payment'>(row.id),
    orderId: toId<'Order'>(row.orderId),
    provider: row.provider,
    status: row.status,
    amount: money(row.amount),
    capturedAmount: money(row.capturedAmount),
    refundedAmount: money(row.refundedAmount),
    capturedAt: row.capturedAt,
    method:
      row.attempts.findLast(({ status }) => status === 'CAPTURED')?.method ??
      null,
    refunds: row.refunds.map((refund) => ({
      id: refund.id,
      amount: money(refund.amount),
      status: refund.status,
      providerRefundId: refund.providerRefundId,
      registeredBy: refund.registeredBy,
      createdAt: refund.createdAt,
      completedAt: refund.completedAt,
    })),
  };
}

function toAdminPaymentView(row: PaymentRow): AdminPaymentView {
  return {
    ...toPaymentView(row),
    orderCode: row.orderCode,
    providerPaymentId: row.providerPaymentId,
    attempts: row.attempts.map((attempt) => ({
      status: attempt.status,
      providerReference: attempt.providerReference,
      method: attempt.method,
      failureCode: attempt.failureCode,
      registeredBy:
        attempt.registeredBy === null
          ? null
          : toId<'User'>(attempt.registeredBy),
      createdAt: attempt.createdAt,
    })),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  };
}
