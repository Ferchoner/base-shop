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
  type PaymentMovements,
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

  async movementsBetween(from: Date, to: Date): Promise<PaymentMovements> {
    const captured = PAYMENT_FIELDS.include.attempts;
    const [payments, refunds] = await Promise.all([
      this.txHost.tx.payment.findMany({
        where: { capturedAt: { gte: from, lt: to } },
        include: { attempts: captured },
        orderBy: [{ capturedAt: 'asc' }, { id: 'asc' }],
      }),
      this.txHost.tx.refund.findMany({
        where: { status: 'COMPLETED', completedAt: { gte: from, lt: to } },
        include: { payment: { include: { attempts: captured } } },
        orderBy: [{ completedAt: 'asc' }, { id: 'asc' }],
      }),
    ]);
    return {
      captures: payments.map((row) => {
        const attempt = capturedAttempt(row.attempts);
        return {
          orderId: toId<'Order'>(row.orderId),
          provider: row.provider,
          method: attempt?.method ?? null,
          amount: Money.of(row.capturedAmount, row.currency as Currency),
          // The query takes only captured payments.
          capturedAt: row.capturedAt!,
          registeredBy: attempt?.registeredBy ?? null,
        };
      }),
      refunds: refunds.map((row) => ({
        orderId: toId<'Order'>(row.payment.orderId),
        amount: Money.of(row.amount, row.payment.currency as Currency),
        // The query takes only completed refunds.
        completedAt: row.completedAt!,
        registeredBy: row.registeredBy,
        paymentMethod: capturedAttempt(row.payment.attempts)?.method ?? null,
      })),
    };
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

/** The attempt that captured a payment: its method, note and staff member (ADR-0161). */
function capturedAttempt<Attempt extends { readonly status: string }>(
  attempts: readonly Attempt[],
): Attempt | undefined {
  return attempts.findLast(({ status }) => status === 'CAPTURED');
}

function toPaymentView(row: PaymentRow): PaymentView {
  const money = (amount: number) => Money.of(amount, row.currency as Currency);
  const captured = capturedAttempt(row.attempts);
  return {
    id: toId<'Payment'>(row.id),
    orderId: toId<'Order'>(row.orderId),
    provider: row.provider,
    status: row.status,
    amount: money(row.amount),
    capturedAmount: money(row.capturedAmount),
    refundedAmount: money(row.refundedAmount),
    capturedAt: row.capturedAt,
    method: captured?.method ?? null,
    note: captured?.note ?? null,
    refunds: row.refunds.map((refund) => ({
      id: refund.id,
      amount: money(refund.amount),
      status: refund.status,
      providerRefundId: refund.providerRefundId,
      registeredBy: refund.registeredBy,
      note: refund.note,
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
      note: attempt.note,
      createdAt: attempt.createdAt,
    })),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  };
}
