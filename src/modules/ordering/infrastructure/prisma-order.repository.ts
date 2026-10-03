import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { Prisma } from '../../../platform/persistence/prisma/generated/client.js';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import {
  Money,
  newId,
  toId,
  VersionConflictError,
} from '../../../shared-kernel/index.js';
import {
  Order,
  type OrderAddress,
  type OrderId,
  type VariantOptions,
} from '../domain/order.js';
import { OrderRepository, type OrdersOf } from '../domain/order.repository.js';
import type { PublicCode } from '../domain/public-code.js';

type OrderRow = Prisma.OrderGetPayload<{ include: { lines: true } }>;

/**
 * Orders in PostgreSQL (DATABASE.md §8). The order row is written with `INSERT … ON CONFLICT (public_code) DO
 * NOTHING`: a repeated public code writes nothing and leaves the transaction usable, so the checkout draws
 * another one instead of losing its reservation (ADR-0049, ADR-0132). The internal number comes from the
 * sequence of `order_number`. A change locks the order row first (`SELECT … FOR UPDATE`, ADR-0133). Dates come
 * from the application, never from the database clock.
 */
@Injectable()
export class PrismaOrderRepository extends OrderRepository {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  async insert(order: Order): Promise<boolean> {
    const o = order.snapshot;
    const { totals } = o;
    const inserted = await this.txHost.tx.$executeRaw`
      INSERT INTO orders (
        id, public_code, customer_id, contact_email, status, currency,
        subtotal, tax_total, shipping_cost, shipping_tax_amount, shipping_tax_rate_bp,
        delivery_min_business_days, delivery_max_business_days, discount_total, grand_total,
        shipping_address, reservation_id, source_cart_id, privacy_notice_version,
        placed_at, payment_due_at, created_at, updated_at)
      VALUES (
        ${o.id}::uuid, ${o.publicCode}, ${o.customerId}::uuid, ${o.contactEmail},
        ${o.status}::order_status, ${totals.grandTotal.currency},
        ${totals.subtotal.amount}, ${totals.taxTotal.amount}, ${totals.shippingCost.amount},
        ${totals.shippingTaxAmount.amount}, ${o.shippingTaxRateBp},
        ${o.deliveryMinBusinessDays}, ${o.deliveryMaxBusinessDays},
        ${totals.discountTotal.amount}, ${totals.grandTotal.amount},
        ${JSON.stringify(o.shippingAddress)}::jsonb, ${o.reservationId}::uuid,
        ${o.sourceCartId}::uuid, ${o.privacyNoticeVersion},
        ${o.placedAt}, ${o.paymentDueAt}, ${o.placedAt}, ${o.placedAt})
      ON CONFLICT (public_code) DO NOTHING`;
    if (inserted === 0) return false;
    await this.txHost.tx.orderLine.createMany({
      data: o.lines.map((line) => ({
        id: line.id,
        orderId: o.id,
        lineNumber: line.lineNumber,
        variantId: line.variantId,
        sku: line.sku,
        productName: line.productName,
        variantOptions: line.variantOptions,
        unitPrice: line.unitPrice.amount,
        quantity: line.quantity,
        taxRateBp: line.taxRateBp,
        taxAmount: line.taxAmount.amount,
        lineTotal: line.lineTotal.amount,
      })),
    });
    await this.txHost.tx.orderStatusHistory.create({
      data: {
        id: newId(),
        orderId: o.id,
        fromStatus: null,
        toStatus: o.status,
        // The customer who placed it; a guest is not an account.
        actorId: o.customerId,
        occurredAt: o.placedAt,
      },
    });
    return true;
  }

  async lock(id: OrderId): Promise<Order | null> {
    const tx = this.txHost.tx;
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM orders WHERE id = ${id}::uuid FOR UPDATE`;
    if (locked.length === 0) return null;
    const row = await tx.order.findUniqueOrThrow({
      where: { id },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    return Order.restore(toSnapshot(row));
  }

  async dueForExpiry(at: Date, limit: number): Promise<OrderId[]> {
    const rows = await this.txHost.tx.order.findMany({
      select: { id: true },
      where: { status: 'PENDING_PAYMENT', paymentDueAt: { lte: at } },
      orderBy: [{ paymentDueAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    return rows.map(({ id }) => toId<'Order'>(id));
  }

  async lockByPublicCode(code: PublicCode): Promise<Order | null> {
    const [locked] = await this.txHost.tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM orders WHERE public_code = ${code} FOR UPDATE`;
    return locked === undefined ? null : this.lock(toId<'Order'>(locked.id));
  }

  async lockOf(buyer: OrdersOf): Promise<Order[]> {
    const tx = this.txHost.tx;
    const locked =
      'customerId' in buyer
        ? await tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM orders
             WHERE customer_id = ${buyer.customerId}::uuid AND anonymized_at IS NULL
             ORDER BY id FOR UPDATE`
        : await tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM orders
             WHERE customer_id IS NULL AND contact_email = ${buyer.guestEmail}
             ORDER BY id FOR UPDATE`;
    if (locked.length === 0) return [];
    const rows = await tx.order.findMany({
      where: { id: { in: locked.map(({ id }) => id) } },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => Order.restore(toSnapshot(row)));
  }

  async save(order: Order, now: Date): Promise<void> {
    if (!order.hasChanges) return;
    const o = order.snapshot;
    const tx = this.txHost.tx;
    const { count } = await tx.order.updateMany({
      where: { id: o.id, version: o.version },
      data: {
        status: o.status,
        contactEmail: o.contactEmail,
        shippingAddress: o.shippingAddress as unknown as Prisma.InputJsonObject,
        anonymizedAt: o.anonymizedAt,
        reservationId: o.reservationId,
        paidAt: o.paidAt,
        shippedAt: o.shippedAt,
        deliveredAt: o.deliveredAt,
        cancelledAt: o.cancelledAt,
        expiredAt: o.expiredAt,
        refundedAt: o.refundedAt,
        version: { increment: 1 },
        updatedAt: now,
      },
    });
    if (count === 0) {
      const current = await tx.order.findUniqueOrThrow({
        where: { id: o.id },
        select: { version: true },
      });
      throw new VersionConflictError(current.version);
    }
    if (order.statusChanges.length > 0) {
      await tx.orderStatusHistory.createMany({
        data: order.statusChanges.map((change) => ({
          id: newId(),
          orderId: o.id,
          fromStatus: change.from,
          toStatus: change.to,
          actorId: change.actorId,
          reason: change.reason,
          occurredAt: change.at,
        })),
      });
    }
  }
}

function toSnapshot(row: OrderRow) {
  const money = (amount: number) => Money.of(amount, 'MXN');
  return {
    id: toId<'Order'>(row.id),
    publicCode: row.publicCode as PublicCode,
    customerId: row.customerId === null ? null : toId<'User'>(row.customerId),
    contactEmail: row.contactEmail,
    privacyNoticeVersion: row.privacyNoticeVersion,
    status: row.status,
    lines: row.lines.map((line) => ({
      id: toId<'OrderLine'>(line.id),
      lineNumber: line.lineNumber,
      variantId: toId<'Variant'>(line.variantId),
      sku: line.sku,
      productName: line.productName,
      variantOptions: line.variantOptions as VariantOptions,
      unitPrice: money(line.unitPrice),
      quantity: line.quantity,
      taxRateBp: line.taxRateBp,
      taxAmount: money(line.taxAmount),
      lineTotal: money(line.lineTotal),
    })),
    totals: {
      subtotal: money(row.subtotal),
      taxTotal: money(row.taxTotal),
      shippingCost: money(row.shippingCost),
      shippingTaxAmount: money(row.shippingTaxAmount),
      discountTotal: money(row.discountTotal),
      grandTotal: money(row.grandTotal),
    },
    shippingTaxRateBp: row.shippingTaxRateBp,
    deliveryMinBusinessDays: row.deliveryMinBusinessDays,
    deliveryMaxBusinessDays: row.deliveryMaxBusinessDays,
    // Written by insert from ShippingAddress, and by save once anonymized.
    shippingAddress: row.shippingAddress as unknown as OrderAddress,
    reservationId:
      row.reservationId === null
        ? null
        : toId<'Reservation'>(row.reservationId),
    paymentDueAt: row.paymentDueAt,
    sourceCartId: toId<'Cart'>(row.sourceCartId),
    placedAt: row.placedAt,
    paidAt: row.paidAt,
    shippedAt: row.shippedAt,
    deliveredAt: row.deliveredAt,
    cancelledAt: row.cancelledAt,
    expiredAt: row.expiredAt,
    refundedAt: row.refundedAt,
    anonymizedAt: row.anonymizedAt,
    version: row.version,
  };
}
