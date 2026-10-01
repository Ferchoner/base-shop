import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import {
  type Currency,
  Money,
  newId,
  toId,
  VersionConflictError,
} from '../../../shared-kernel/index.js';
import {
  type OrderId,
  Payment,
  type PaymentAttempt,
} from '../domain/payment.js';
import { PaymentRepository } from '../domain/payment.repository.js';

/**
 * Payments in PostgreSQL (DATABASE.md §9). Attempts are append-only. Dates come from the application, never
 * from the database clock.
 */
@Injectable()
export class PrismaPaymentRepository extends PaymentRepository {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  async findByOrder(orderId: OrderId): Promise<Payment | null> {
    const row = await this.txHost.tx.payment.findUnique({
      where: { orderId },
      include: {
        attempts: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      },
    });
    if (row === null) return null;
    const currency = row.currency as Currency;
    const money = (amount: number) => Money.of(amount, currency);
    return Payment.restore({
      id: toId<'Payment'>(row.id),
      orderId: toId<'Order'>(row.orderId),
      orderCode: row.orderCode,
      provider: row.provider,
      status: row.status,
      amount: money(row.amount),
      capturedAmount: money(row.capturedAmount),
      refundedAmount: money(row.refundedAmount),
      providerPaymentId: row.providerPaymentId,
      capturedAt: row.capturedAt,
      attempts: row.attempts.map((attempt) => ({
        status: attempt.status,
        providerReference: attempt.providerReference,
        failureCode: attempt.failureCode,
        registeredBy:
          attempt.registeredBy === null
            ? null
            : toId<'User'>(attempt.registeredBy),
        createdAt: attempt.createdAt,
      })),
      version: row.version,
    });
  }

  async insert(payment: Payment, now: Date): Promise<void> {
    const p = payment.snapshot;
    await this.txHost.tx.payment.create({
      data: {
        id: p.id,
        orderId: p.orderId,
        orderCode: p.orderCode,
        provider: p.provider,
        status: p.status,
        amount: p.amount.amount,
        capturedAmount: p.capturedAmount.amount,
        refundedAmount: p.refundedAmount.amount,
        currency: p.amount.currency,
        providerPaymentId: p.providerPaymentId,
        capturedAt: p.capturedAt,
        createdAt: now,
        updatedAt: now,
      },
    });
    await this.addAttempts(payment.id, payment.newAttempts);
  }

  async save(payment: Payment, now: Date): Promise<void> {
    const p = payment.snapshot;
    const tx = this.txHost.tx;
    const { count } = await tx.payment.updateMany({
      where: { id: p.id, version: p.version },
      data: {
        status: p.status,
        capturedAmount: p.capturedAmount.amount,
        refundedAmount: p.refundedAmount.amount,
        providerPaymentId: p.providerPaymentId,
        capturedAt: p.capturedAt,
        version: { increment: 1 },
        updatedAt: now,
      },
    });
    if (count === 0) {
      const current = await tx.payment.findUniqueOrThrow({
        where: { id: p.id },
        select: { version: true },
      });
      throw new VersionConflictError(current.version);
    }
    await this.addAttempts(payment.id, payment.newAttempts);
  }

  private async addAttempts(
    paymentId: string,
    attempts: readonly PaymentAttempt[],
  ): Promise<void> {
    if (attempts.length === 0) return;
    await this.txHost.tx.paymentAttempt.createMany({
      data: attempts.map((attempt) => ({
        id: newId(),
        paymentId,
        status: attempt.status,
        providerReference: attempt.providerReference,
        failureCode: attempt.failureCode,
        registeredBy: attempt.registeredBy,
        createdAt: attempt.createdAt,
      })),
    });
  }
}
