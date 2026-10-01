import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import { newId } from '../../../shared-kernel/index.js';
import type { Order } from '../domain/order.js';
import { OrderRepository } from '../domain/order.repository.js';

/**
 * Orders in PostgreSQL (DATABASE.md §8). The order row is written with `INSERT … ON CONFLICT (public_code) DO
 * NOTHING`: a repeated public code writes nothing and leaves the transaction usable, so the checkout draws
 * another one instead of losing its reservation (ADR-0049, ADR-0132). The internal number comes from the
 * sequence of `order_number`. Dates come from the application, never from the database clock.
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
        id: newId(),
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
}
