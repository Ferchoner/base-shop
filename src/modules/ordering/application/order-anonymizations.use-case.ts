import { Injectable } from '@nestjs/common';
import {
  AuditTrail,
  changesBetween,
  NotFoundError,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import {
  type CustomerId,
  normalizedContactEmail,
  type Order,
} from '../domain/order.js';
import { OrderAccessTokenRepository } from '../domain/order-access-token.js';
import { OrderRepository, type OrdersOf } from '../domain/order.repository.js';
import { parsePublicCode } from '../domain/public-code.js';
import { PlacementResponses } from './placement-responses.js';
import { OrderShipments } from './shipment-ports.js';

/**
 * Whose orders are anonymized (ADR-0067): a customer's, or a guest's, who shows the email and the public code of one
 * of their orders, as in the lookup (ADR-0138).
 */
export type AnonymizedBuyer =
  | { readonly customerId: CustomerId }
  | { readonly contactEmail: string; readonly publicCode: string };

/**
 * The anonymization of the orders of a buyer (UC-IAM-19, ADR-0067), asked by Privacy, which anonymizes the account of
 * a customer in the same transaction (ADR-0145). Ordering anonymizes the shipments of its orders too, as it cancels
 * them, because Shipping never reads Ordering, and forgets the responses kept for placing them. For a guest, it deletes
 * the access links of the email too (ADR-0148).
 */
@Injectable()
export class OrderAnonymizations {
  constructor(
    private readonly orders: OrderRepository,
    private readonly shipments: OrderShipments,
    private readonly accessTokens: OrderAccessTokenRepository,
    private readonly responses: PlacementResponses,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
  ) {}

  /**
   * Anonymizes every order of the buyer that was not anonymized, and their shipments, all or none: each one must
   * have concluded (ADR-0070, ADR-0145). Each order is audited as `orders.anonymize`, without the values
   * (BR-PRIV-04). A guest's orders are those of guests with the email; a customer's orders with the same email stay.
   *
   * @returns how many orders it anonymized.
   * @throws NotFoundError for a guest when no guest order has the code and the email, the same as the lookup
   *   (BR-ORD-11); ActiveOrdersExistError when an order has not concluded (E-31).
   */
  anonymize(input: {
    buyer: AnonymizedBuyer;
    reason: string;
    at: Date;
  }): Promise<number> {
    return this.transactions.run(async () => {
      const buyer = ordersOf(input.buyer);
      const orders = await this.orders.lockOf(buyer);
      if ('publicCode' in input.buyer) {
        const code = parsePublicCode(input.buyer.publicCode);
        if (!orders.some((order) => order.publicCode === code)) {
          // Without the email nor the code, also in the log (BR-ORD-11, ADR-0071).
          throw new NotFoundError('Guest order', 'with that email and code');
        }
      }
      if (orders.length === 0) return 0;
      const ids = orders.map(({ id }) => id);
      const shipments = await this.shipments.shipmentsOf(ids);
      // Every order first, so one that has not concluded stops it before anything is written.
      const changes = orders.map((order) => {
        const before = personalFields(order);
        order.anonymize(shipments.get(order.id)?.status ?? null, input.at);
        return changesBetween(before, personalFields(order));
      });
      for (const [index, order] of orders.entries()) {
        await this.orders.save(order, input.at);
        await this.audit.record({
          action: 'orders.anonymize',
          resource: { type: 'order', id: order.id },
          changes: changes[index],
          reason: input.reason,
        });
      }
      await this.shipments.anonymize(ids, input.at);
      if ('guestEmail' in buyer)
        await this.accessTokens.deleteOf(buyer.guestEmail);
      // Last, because it runs outside the transaction: if the anonymization fails after all, only the replay of a
      // request repeated within 24 hours is lost.
      await this.responses.forgetOf(orders);
      return orders.length;
    });
  }
}

function ordersOf(buyer: AnonymizedBuyer): OrdersOf {
  return 'customerId' in buyer
    ? { customerId: buyer.customerId }
    : { guestEmail: normalizedContactEmail(buyer.contactEmail) };
}

/** The personal fields of an order, which the audit trail records only as changed (BR-PRIV-04). */
function personalFields(order: Order): Record<string, unknown> {
  const { contactEmail, shippingAddress } = order.snapshot;
  return { contactEmail, shippingAddress };
}
