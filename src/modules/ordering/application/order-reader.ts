import { Injectable } from '@nestjs/common';
import type {
  Page,
  PageRequest,
  SortOrder,
} from '../../../shared-kernel/index.js';
import {
  type CustomerId,
  normalizedContactEmail,
  type OrderId,
} from '../domain/order.js';
import type { PublicCode } from '../domain/public-code.js';
import {
  type AdminOrderSummaryView,
  type AdminOrderView,
  type CustomerOrderFilter,
  type CustomerOrderSortField,
  type OrderFilter,
  OrderingQueries,
  type OrderSortField,
  type OrderSummaryView,
  type OrderView,
} from './ordering.queries.js';
import { type OrderPayment, OrderPayments } from './payment-ports.js';
import { type OrderShipment, OrderShipments } from './shipment-ports.js';

/**
 * A view of an order with its payment and its shipment, each `null` while it has none (API_SPEC.md §8.8 and
 * §8.9).
 */
export type WithPaymentAndShipment<View> = View & {
  readonly payment: OrderPayment | null;
  readonly shipment: OrderShipment | null;
};

/**
 * The orders as the API shows them: the views of Ordering with their payment, which Payments keeps (ADR-0134).
 * Each read asks Payments once, also for a whole page.
 */
@Injectable()
export class OrderReader {
  constructor(
    private readonly queries: OrderingQueries,
    private readonly payments: OrderPayments,
    private readonly shipments: OrderShipments,
  ) {}

  async order(id: OrderId): Promise<WithPaymentAndShipment<OrderView> | null> {
    return this.attach(await this.queries.findOrder(id));
  }

  async customerOrder(
    customerId: CustomerId,
    publicCode: PublicCode,
  ): Promise<WithPaymentAndShipment<OrderView> | null> {
    return this.attach(
      await this.queries.findCustomerOrder(customerId, publicCode),
    );
  }

  /**
   * A guest's order, found with its public code and contact email (UC-ORD-04, ADR-0138); `null` alike when it
   * does not exist, the email is another one or it is a customer's order (BR-ORD-11).
   */
  async guestOrder(
    publicCode: PublicCode,
    contactEmail: string,
  ): Promise<WithPaymentAndShipment<OrderView> | null> {
    return this.attach(
      await this.queries.findGuestOrder(
        publicCode,
        normalizedContactEmail(contactEmail),
      ),
    );
  }

  async adminOrder(
    id: OrderId,
  ): Promise<WithPaymentAndShipment<AdminOrderView> | null> {
    return this.attach(await this.queries.findAdminOrder(id));
  }

  async customerOrders(
    customerId: CustomerId,
    filter: CustomerOrderFilter,
    sort: readonly SortOrder<CustomerOrderSortField>[],
    page: PageRequest,
  ): Promise<Page<WithPaymentAndShipment<OrderSummaryView>>> {
    return this.attachAll(
      await this.queries.listCustomerOrders(customerId, filter, sort, page),
    );
  }

  async orders(
    filter: OrderFilter,
    sort: readonly SortOrder<OrderSortField>[],
    page: PageRequest,
  ): Promise<Page<WithPaymentAndShipment<AdminOrderSummaryView>>> {
    return this.attachAll(await this.queries.listOrders(filter, sort, page));
  }

  private async attach<View extends { readonly id: OrderId }>(
    view: View | null,
  ): Promise<WithPaymentAndShipment<View> | null> {
    if (view === null) return null;
    const [attached] = (await this.attachAll({ items: [view], totalItems: 1 }))
      .items;
    return attached;
  }

  /** The payments and the shipments of a whole page, in one read of each. */
  private async attachAll<View extends { readonly id: OrderId }>(
    page: Page<View>,
  ): Promise<Page<WithPaymentAndShipment<View>>> {
    const ids = page.items.map(({ id }) => id);
    const payments = await this.payments.paymentsOf(ids);
    const shipments = await this.shipments.shipmentsOf(ids);
    return {
      ...page,
      items: page.items.map((view) => ({
        ...view,
        payment: payments.get(view.id) ?? null,
        shipment: shipments.get(view.id) ?? null,
      })),
    };
  }
}
