import { Inject, Injectable } from '@nestjs/common';
import {
  Clock,
  DomainEventPublisher,
  Money,
  newId,
  NotFoundError,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import {
  type Buyer,
  type CartId,
  type CustomerId,
  Order,
  type OrderId,
  orderTotals,
  type OrderTotals,
  type PricedLine,
  priceLine,
  type ShippingAddress,
  type VariantId,
  type VariantOptions,
} from '../domain/order.js';
import { OrderRepository } from '../domain/order.repository.js';
import {
  EmailNotVerifiedError,
  EmptyCartError,
  InvalidShippingAddressError,
  TotalMismatchError,
  VariantNotSellableError,
} from '../domain/ordering-errors.js';
import { newPublicCode } from '../domain/public-code.js';
import {
  type CheckoutCart,
  CheckoutCarts,
  CheckoutCatalog,
  CheckoutCustomers,
  CheckoutPrices,
  CheckoutShipping,
  type CheckoutTarget,
  type CheckoutVariant,
  OrderStock,
  ShippingLocations,
} from './checkout-ports.js';
import { orderPlaced } from './order-events.js';
import { VAT_RATE_BP } from './vat-rate.js';

/** Times a new public code is drawn when the one drawn is taken (ADR-0049): a repeat is already rare. */
const PUBLIC_CODE_ATTEMPTS = 5;

/** An address as the customer writes it (ADR-0057): the names of the state and municipality come from Geo. */
export type AddressInput = Omit<
  ShippingAddress,
  'stateName' | 'municipalityName' | 'country'
>;

/** A line of the quote. A line that cannot be sold has no price nor VAT (API_SPEC.md §8.7). */
export interface QuoteLine {
  readonly variantId: VariantId;
  readonly quantity: number;
  readonly sku: string;
  readonly productTitle: string;
  readonly options: VariantOptions;
  readonly unitPrice: Money | null;
  readonly lineTotal: Money | null;
  readonly taxRateBp: number | null;
  readonly taxAmount: Money | null;
  readonly sellable: boolean;
  readonly canFulfill: boolean;
}

/** UC-ORD-01: what the order would cost now. The totals count only the lines that can be sold. */
export interface CheckoutQuote {
  readonly lines: readonly QuoteLine[];
  readonly totals: OrderTotals;
  readonly freeShippingThreshold: Money | null;
  readonly deliveryMinBusinessDays: number;
  readonly deliveryMaxBusinessDays: number;
  /** Every line can be sold and fulfilled: the order can be placed with `grandTotal` as `expectedTotal`. */
  readonly readyToPlace: boolean;
}

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

/** The lines of a cart with what Catalog and Pricing say of them now. */
interface Assessment {
  readonly items: readonly {
    readonly variant: CheckoutVariant;
    readonly quantity: number;
    /** `null` when the line cannot be sold now. */
    readonly priced: PricedLine | null;
  }[];
  readonly priced: readonly PricedLine[];
}

/**
 * The checkout (UC-ORD-01 and 02, ADR-0019, ADR-0132). Both read the variants, prices and shipping in force
 * now, never from a cache (ADR-0028). Placing an order locks the cart, reserves the stock, creates the order and
 * marks the cart in one transaction, so it all happens or nothing does.
 */
@Injectable()
export class Checkout {
  constructor(
    private readonly carts: CheckoutCarts,
    private readonly catalog: CheckoutCatalog,
    private readonly prices: CheckoutPrices,
    private readonly stock: OrderStock,
    private readonly shipping: CheckoutShipping,
    private readonly customers: CheckoutCustomers,
    private readonly locations: ShippingLocations,
    private readonly orders: OrderRepository,
    private readonly transactions: TransactionManager,
    private readonly events: DomainEventPublisher,
    private readonly clock: Clock,
    @Inject(VAT_RATE_BP) private readonly taxRateBp: number,
  ) {}

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
    const assessment = await this.assess(cart, this.clock.now());
    const available = await this.stock.canFulfill(
      assessment.priced.map(({ variantId, quantity }) => ({
        variantId,
        quantity,
      })),
    );
    const shipping = await this.quoteShipping(assessment.priced);
    const lines = assessment.items.map(
      ({ variant, quantity, priced }): QuoteLine => ({
        variantId: variant.id,
        quantity,
        sku: variant.sku,
        productTitle: variant.productName,
        options: variant.options,
        unitPrice: priced?.unitPrice ?? null,
        lineTotal: priced?.lineTotal ?? null,
        taxRateBp: priced?.taxRateBp ?? null,
        taxAmount: priced?.taxAmount ?? null,
        sellable: priced !== null,
        canFulfill: available.get(variant.id) === true,
      }),
    );
    return {
      lines,
      totals: orderTotals(assessment.priced, shipping),
      freeShippingThreshold: shipping.freeShippingThreshold,
      deliveryMinBusinessDays: shipping.deliveryMinBusinessDays,
      deliveryMaxBusinessDays: shipping.deliveryMaxBusinessDays,
      readyToPlace: lines.every(
        ({ sellable, canFulfill }) => sellable && canFulfill,
      ),
    };
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
      const buyer = await this.buyerOf(input);
      const cart = await this.carts.lockToOrder(
        'customerId' in input
          ? { customerId: input.customerId }
          : { guestCartId: input.guestCartId },
      );
      if (cart === null || cart.lines.length === 0) {
        throw new EmptyCartError();
      }
      const shippingAddress = await this.shippingAddressOf(input);
      const { items, priced } = await this.assess(cart, now);
      const unsellable = items
        .filter((item) => item.priced === null)
        .map(({ variant }) => variant.id);
      if (unsellable.length > 0) throw new VariantNotSellableError(unsellable);
      const shipping = await this.quoteShipping(priced);
      const total = orderTotals(priced, shipping).grandTotal;
      if (total.amount !== input.expectedTotal) {
        throw new TotalMismatchError(total);
      }
      const id = newId<'Order'>();
      const reservation = await this.stock.reserve(
        id,
        priced.map(({ variantId, quantity }) => ({ variantId, quantity })),
      );
      const order = await this.insert({
        id,
        buyer,
        lines: priced,
        shipping,
        shippingAddress,
        reservation,
        sourceCartId: cart.id,
        now,
      });
      await this.carts.checkOut(cart.id);
      // The email of the received order (ADR-0074), once the order commits.
      this.events.publish(orderPlaced(order.id, now));
      return order.id;
    });
  }

  /** @throws EmailNotVerifiedError; NotFoundError for a customer that is not ACTIVE anymore. */
  private async buyerOf(
    input: GuestOrderInput | CustomerOrderInput,
  ): Promise<Buyer> {
    if (!('customerId' in input)) {
      return {
        customerId: null,
        contactEmail: input.contactEmail,
        privacyNoticeVersion: input.privacyNoticeVersion,
      };
    }
    const contact = await this.customers.contact(input.customerId);
    // Authentication lets only ACTIVE accounts through (ADR-0114); this covers a suspension in between.
    if (contact === null) throw new NotFoundError('Customer', input.customerId);
    if (!contact.emailVerified) throw new EmailNotVerifiedError();
    return { customerId: input.customerId, contactEmail: contact.email };
  }

  /** @throws NotFoundError for a saved address that is not the customer's; InvalidShippingAddressError. */
  private async shippingAddressOf(
    input: GuestOrderInput | CustomerOrderInput,
  ): Promise<ShippingAddress> {
    const address = input.shippingAddress;
    if ('addressId' in address) {
      // Only the customer route takes an `addressId`.
      const saved = await this.customers.address(
        (input as CustomerOrderInput).customerId,
        address.addressId,
      );
      if (saved === null) throw new NotFoundError('Address', address.addressId);
      return saved;
    }
    const names = await this.locations.resolve(
      address.stateCode,
      address.municipalityCode,
    );
    if (typeof names === 'string') throw new InvalidShippingAddressError(names);
    return {
      recipientName: address.recipientName,
      phone: address.phone,
      street: address.street,
      exteriorNumber: address.exteriorNumber,
      interiorNumber: address.interiorNumber,
      neighborhood: address.neighborhood,
      postalCode: address.postalCode,
      stateCode: address.stateCode,
      stateName: names.stateName,
      municipalityCode: address.municipalityCode,
      municipalityName: names.municipalityName,
      city: address.city,
      references: address.references,
      country: 'MX',
    };
  }

  /** Each line with its variant and, when it can be sold now, its price and VAT (BR-PRD-11, BR-TAX-02). */
  private async assess(cart: CheckoutCart, at: Date): Promise<Assessment> {
    const ids = cart.lines.map(({ variantId }) => variantId);
    const variants = await this.catalog.variants(ids);
    const prices = await this.prices.current(ids, at);
    const items = cart.lines.map(({ variantId, quantity }) => {
      const variant = variants.get(variantId);
      // Variants are never deleted (BR-PRD-07), and a cart only gets lines of variants that exist.
      if (variant === undefined) {
        throw new Error(
          `The cart has a line of variant ${variantId}, which does not exist`,
        );
      }
      const unitPrice = prices.get(variantId);
      const priced =
        variant.onSale && unitPrice !== undefined
          ? priceLine(
              {
                variantId,
                sku: variant.sku,
                productName: variant.productName,
                variantOptions: variant.options,
                unitPrice,
                quantity,
              },
              this.taxRateBp,
            )
          : null;
      return { variant, quantity, priced };
    });
    return {
      items,
      priced: items.flatMap(({ priced }) => (priced === null ? [] : [priced])),
    };
  }

  /** The shipping of these lines: free from the threshold on, which the shipping itself does not count. */
  private quoteShipping(lines: readonly PricedLine[]) {
    const zero = Money.zero('MXN');
    return this.shipping.quote({
      subtotal: lines.reduce((sum, line) => sum.add(line.lineTotal), zero),
      discount: zero,
    });
  }

  /** Saves the order, drawing another public code while the one drawn is taken (ADR-0049). */
  private async insert(
    input: Omit<Parameters<typeof Order.place>[0], 'publicCode'>,
  ): Promise<Order> {
    for (let attempt = 1; ; attempt++) {
      const order = Order.place({ ...input, publicCode: newPublicCode() });
      if (await this.orders.insert(order)) return order;
      if (attempt === PUBLIC_CODE_ATTEMPTS) {
        throw new Error(`No free public code after ${attempt} attempts`);
      }
    }
  }
}
