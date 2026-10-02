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

/** A view of an order with its payment, `null` while it has none (API_SPEC.md §8.8 and §8.9). */
export type WithPayment<View> = View & {
  readonly payment: OrderPayment | null;
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
  ) {}

  async order(id: OrderId): Promise<WithPayment<OrderView> | null> {
    return this.withPayment(await this.queries.findOrder(id));
  }

  async customerOrder(
    customerId: CustomerId,
    publicCode: PublicCode,
  ): Promise<WithPayment<OrderView> | null> {
    return this.withPayment(
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
  ): Promise<WithPayment<OrderView> | null> {
    return this.withPayment(
      await this.queries.findGuestOrder(
        publicCode,
        normalizedContactEmail(contactEmail),
      ),
    );
  }

  async adminOrder(id: OrderId): Promise<WithPayment<AdminOrderView> | null> {
    return this.withPayment(await this.queries.findAdminOrder(id));
  }

  async customerOrders(
    customerId: CustomerId,
    filter: CustomerOrderFilter,
    sort: readonly SortOrder<CustomerOrderSortField>[],
    page: PageRequest,
  ): Promise<Page<WithPayment<OrderSummaryView>>> {
    return this.withPayments(
      await this.queries.listCustomerOrders(customerId, filter, sort, page),
    );
  }

  async orders(
    filter: OrderFilter,
    sort: readonly SortOrder<OrderSortField>[],
    page: PageRequest,
  ): Promise<Page<WithPayment<AdminOrderSummaryView>>> {
    return this.withPayments(await this.queries.listOrders(filter, sort, page));
  }

  private async withPayment<View extends { readonly id: OrderId }>(
    view: View | null,
  ): Promise<WithPayment<View> | null> {
    if (view === null) return null;
    const payments = await this.payments.paymentsOf([view.id]);
    return { ...view, payment: payments.get(view.id) ?? null };
  }

  private async withPayments<View extends { readonly id: OrderId }>(
    page: Page<View>,
  ): Promise<Page<WithPayment<View>>> {
    const payments = await this.payments.paymentsOf(
      page.items.map(({ id }) => id),
    );
    return {
      ...page,
      items: page.items.map((view) => ({
        ...view,
        payment: payments.get(view.id) ?? null,
      })),
    };
  }
}
