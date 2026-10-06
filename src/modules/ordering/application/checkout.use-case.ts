import { Inject, Injectable } from '@nestjs/common';
import {
  Clock,
  DomainEventPublisher,
  newId,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import {
  type CartId,
  type CustomerId,
  Order,
  type OrderId,
  orderTotals,
} from '../domain/order.js';
import { OrderRepository } from '../domain/order.repository.js';
import {
  EmptyCartError,
  TotalMismatchError,
  VariantNotSellableError,
} from '../domain/ordering-errors.js';
import {
  CheckoutCarts,
  CheckoutCatalog,
  CheckoutCustomers,
  CheckoutPrices,
  CheckoutShipping,
  type CheckoutTarget,
  OrderStock,
  ShippingLocations,
} from './checkout-ports.js';
import { orderPlaced } from './order-events.js';
import {
  type AddressInput,
  type CheckoutQuote,
  OrderPlacement,
} from './order-placement.js';
import { VAT_RATE_BP } from './vat-rate.js';

export type {
  AddressInput,
  CheckoutQuote,
  QuoteLine,
} from './order-placement.js';

/** UC-ORD-02, guest route: the contact and address come with the order (ADR-0067). */
export interface GuestOrderInput {
  readonly guestCartId: CartId;
  readonly contactEmail: string;
  readonly shippingAddress: AddressInput;
  readonly privacyNoticeVersion: string;
  /** `grandTotal.amount` of the quote the customer accepted (ADR-0019). */
  readonly expectedTotal: number;
}

/** UC-ORD-02, customer route: the contact is the account email, and the address is saved or not. */
export interface CustomerOrderInput {
  readonly customerId: CustomerId;
  readonly shippingAddress: { readonly addressId: string } | AddressInput;
  readonly expectedTotal: number;
}

/**
 * The checkout (UC-ORD-01 and 02, ADR-0019, ADR-0132). Both read the variants, prices and shipping in force
 * now, never from a cache (ADR-0028). Placing an order locks the cart, reserves the stock, creates the order and
 * marks the cart in one transaction, so it all happens or nothing does.
 */
@Injectable()
export class Checkout {
  private readonly placement: OrderPlacement;

  constructor(
    private readonly carts: CheckoutCarts,
    catalog: CheckoutCatalog,
    prices: CheckoutPrices,
    private readonly stock: OrderStock,
    shipping: CheckoutShipping,
    customers: CheckoutCustomers,
    locations: ShippingLocations,
    orders: OrderRepository,
    private readonly transactions: TransactionManager,
    private readonly events: DomainEventPublisher,
    private readonly clock: Clock,
    @Inject(VAT_RATE_BP) taxRateBp: number,
  ) {
    this.placement = new OrderPlacement(
      catalog,
      prices,
      shipping,
      customers,
      locations,
      orders,
      taxRateBp,
    );
  }

  /**
   * What the order of the cart would cost now (UC-ORD-01), without changing anything. Lines that cannot be
   * sold or fulfilled are marked, and the quote is not ready to place.
   *
   * @throws NotFoundError for a guest cart that does not exist or has an owner; CartNotActiveError;
   *   EmptyCartError for a cart without lines, or a customer without an active cart.
   */
  async quote(target: CheckoutTarget): Promise<CheckoutQuote> {
    const cart = await this.carts.toQuote(target);
    if (cart === null || cart.lines.length === 0) throw new EmptyCartError();
    const assessment = await this.placement.assess(
      cart.lines,
      this.clock.now(),
    );
    const available = await this.stock.canFulfill(
      assessment.priced.map(({ variantId, quantity }) => ({
        variantId,
        quantity,
      })),
    );
    const shipping = await this.placement.quoteShipping(assessment.priced);
    return this.placement.quoteOf(assessment, available, shipping);
  }

  /**
   * Places the order of a cart (UC-ORD-02) in PENDING_PAYMENT, with its stock reserved until the reservation
   * expires, and leaves the cart CHECKED_OUT. Checks, in this order: the buyer, the cart, the address, that
   * every line can be sold, the total and the stock.
   *
   * @throws EmailNotVerifiedError (BR-USR-05); NotFoundError for the cart or a saved address;
   *   CartNotActiveError; EmptyCartError; InvalidShippingAddressError; VariantNotSellableError;
   *   TotalMismatchError (BR-ORD-06); InsufficientStockError, reserving nothing (BR-INV-02).
   */
  placeOrder(input: GuestOrderInput | CustomerOrderInput): Promise<OrderId> {
    return this.transactions.run(async () => {
      const now = this.clock.now();
      const customerId = 'customerId' in input ? input.customerId : null;
      const buyer = await this.placement.buyer(
        'customerId' in input ? { customerId: input.customerId } : input,
      );
      const cart = await this.carts.lockToOrder(
        'customerId' in input
          ? { customerId: input.customerId }
          : { guestCartId: input.guestCartId },
      );
      if (cart === null || cart.lines.length === 0) {
        throw new EmptyCartError();
      }
      const shippingAddress = await this.placement.shippingAddress(
        customerId,
        input.shippingAddress,
      );
      const { items, priced } = await this.placement.assess(cart.lines, now);
      const unsellable = items
        .filter((item) => item.priced === null)
        .map(({ variant }) => variant.id);
      if (unsellable.length > 0) throw new VariantNotSellableError(unsellable);
      const shipping = await this.placement.quoteShipping(priced);
      const total = orderTotals(priced, shipping).grandTotal;
      if (total.amount !== input.expectedTotal) {
        throw new TotalMismatchError(total);
      }
      const id = newId<'Order'>();
      const reservation = await this.stock.reserve(
        id,
        priced.map(({ variantId, quantity }) => ({ variantId, quantity })),
      );
      const order = await this.placement.insert((publicCode) =>
        Order.place({
          id,
          publicCode,
          buyer,
          lines: priced,
          shipping,
          shippingAddress,
          reservation,
          sourceCartId: cart.id,
          now,
        }),
      );
      await this.carts.checkOut(cart.id);
      // The email of the received order (ADR-0074), once the order commits.
      this.events.publish(orderPlaced(order.id, now));
      return order.id;
    });
  }
}
