import { Money, NotFoundError } from '../../../shared-kernel/index.js';
import {
  type Buyer,
  type CustomerId,
  type Order,
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
  InvalidShippingAddressError,
} from '../domain/ordering-errors.js';
import { newPublicCode, type PublicCode } from '../domain/public-code.js';
import {
  CheckoutCatalog,
  CheckoutCustomers,
  CheckoutPrices,
  CheckoutShipping,
  type CheckoutVariant,
  type ShippingCharge,
  ShippingLocations,
  type StockLine,
} from './checkout-ports.js';

/** Times a new public code is drawn when the one drawn is taken (ADR-0049): a repeat is already rare. */
const PUBLIC_CODE_ATTEMPTS = 5;

/** An address as the customer writes it (ADR-0057): the names of the state and municipality come from Geo. */
export type AddressInput = Omit<
  ShippingAddress,
  'stateName' | 'municipalityName' | 'country'
>;

/** Where an order ships: a saved address of the customer, by its ID, or one written for the order. */
export type AddressChoice = { readonly addressId: string } | AddressInput;

/** Who an order is for: a customer, by its ID, or a guest with the contact and the privacy notice shown (ADR-0067). */
export type BuyerChoice =
  | { readonly customerId: CustomerId }
  | {
      readonly contactEmail: string;
      readonly privacyNoticeVersion: string;
    };

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
  /** Whether the line fits in the order with the others: false for the ones placing it would find short (ADR-0160). */
  readonly canFulfill: boolean;
}

/** UC-ORD-01: what the order would cost now. The totals count only the lines that can be sold. */
export interface CheckoutQuote {
  readonly lines: readonly QuoteLine[];
  readonly totals: OrderTotals;
  readonly freeShippingThreshold: Money | null;
  /** `null` for an order handed over in the store, which ships nowhere (ADR-0161). */
  readonly deliveryMinBusinessDays: number | null;
  readonly deliveryMaxBusinessDays: number | null;
  /** Every line can be sold and fulfilled: the order can be placed with `grandTotal` as `expectedTotal`. */
  readonly readyToPlace: boolean;
}

/** What a quote shows of the shipping: an order handed over in the store has none (ADR-0161). */
export type QuotedShipping = Pick<
  ShippingCharge,
  'cost' | 'taxAmount' | 'freeShippingThreshold'
> & {
  readonly deliveryMinBusinessDays: number | null;
  readonly deliveryMaxBusinessDays: number | null;
};

/** The shipping of an order handed over in the store: free, without a threshold nor a delivery time (ADR-0161). */
export const NO_SHIPPING: QuotedShipping = {
  cost: Money.zero('MXN'),
  taxAmount: Money.zero('MXN'),
  freeShippingThreshold: null,
  deliveryMinBusinessDays: null,
  deliveryMaxBusinessDays: null,
};

/** The lines of an order with what Catalog and Pricing say of them now. */
export interface Assessment {
  readonly items: readonly {
    readonly variant: CheckoutVariant;
    readonly quantity: number;
    /** `null` when the line cannot be sold now. */
    readonly priced: PricedLine | null;
  }[];
  readonly priced: readonly PricedLine[];
}

/**
 * What placing an order needs wherever its lines come from, a cart or the staff (ADR-0132, ADR-0161): their prices and
 * VAT now, their shipping, the buyer, the address, and saving the order with a free public code. Every read is in
 * force now, never from a cache (ADR-0028).
 */
export class OrderPlacement {
  constructor(
    private readonly catalog: CheckoutCatalog,
    private readonly prices: CheckoutPrices,
    private readonly shipping: CheckoutShipping,
    private readonly customers: CheckoutCustomers,
    private readonly locations: ShippingLocations,
    private readonly orders: OrderRepository,
    private readonly taxRateBp: number,
  ) {}

  /**
   * Each line with its variant and, when it can be sold now, its price and VAT (BR-PRD-11, BR-TAX-02).
   *
   * @throws NotFoundError for a variant that does not exist.
   */
  async assess(lines: readonly StockLine[], at: Date): Promise<Assessment> {
    const ids = lines.map(({ variantId }) => variantId);
    const variants = await this.catalog.variants(ids);
    const prices = await this.prices.current(ids, at);
    const items = lines.map(({ variantId, quantity }) => {
      const variant = variants.get(variantId);
      if (variant === undefined) throw new NotFoundError('Variant', variantId);
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
  quoteShipping(lines: readonly PricedLine[]): Promise<ShippingCharge> {
    const zero = Money.zero('MXN');
    return this.shipping.quote({
      subtotal: lines.reduce((sum, line) => sum.add(line.lineTotal), zero),
      discount: zero,
    });
  }

  /** The quote of assessed lines, with whether each can be fulfilled (UC-ORD-01, UC-ORD-12). */
  quoteOf(
    { items, priced }: Assessment,
    available: ReadonlyMap<VariantId, boolean>,
    shipping: QuotedShipping,
  ): CheckoutQuote {
    const lines = items.map(
      ({ variant, quantity, priced: line }): QuoteLine => ({
        variantId: variant.id,
        quantity,
        sku: variant.sku,
        productTitle: variant.productName,
        options: variant.options,
        unitPrice: line?.unitPrice ?? null,
        lineTotal: line?.lineTotal ?? null,
        taxRateBp: line?.taxRateBp ?? null,
        taxAmount: line?.taxAmount ?? null,
        sellable: line !== null,
        canFulfill: available.get(variant.id) === true,
      }),
    );
    return {
      lines,
      totals: orderTotals(priced, shipping),
      freeShippingThreshold: shipping.freeShippingThreshold,
      deliveryMinBusinessDays: shipping.deliveryMinBusinessDays,
      deliveryMaxBusinessDays: shipping.deliveryMaxBusinessDays,
      readyToPlace: lines.every(
        ({ sellable, canFulfill }) => sellable && canFulfill,
      ),
    };
  }

  /**
   * The buyer: a guest as given, a customer, whose contact is the account email, or none, who gave no data
   * (ADR-0161).
   *
   * @throws EmailNotVerifiedError (BR-USR-05); NotFoundError for a customer that is not ACTIVE.
   */
  async buyer(choice: BuyerChoice | null): Promise<Buyer> {
    if (choice === null) return { customerId: null, contactEmail: null };
    if (!('customerId' in choice)) {
      return {
        customerId: null,
        contactEmail: choice.contactEmail,
        privacyNoticeVersion: choice.privacyNoticeVersion,
      };
    }
    const contact = await this.customers.contact(choice.customerId);
    if (contact === null) {
      throw new NotFoundError('Customer', choice.customerId);
    }
    if (!contact.emailVerified) throw new EmailNotVerifiedError();
    return { customerId: choice.customerId, contactEmail: contact.email };
  }

  /**
   * Where the order ships: a saved address of the customer, or one written for the order, with the names of its
   * state and municipality from Geo.
   *
   * @throws NotFoundError for a saved address that is not the customer's, or that a guest names;
   *   InvalidShippingAddressError.
   */
  async shippingAddress(
    customerId: CustomerId | null,
    address: AddressChoice,
  ): Promise<ShippingAddress> {
    if ('addressId' in address) {
      const saved =
        customerId === null
          ? null
          : await this.customers.address(customerId, address.addressId);
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

  /** Saves the order `create` makes, drawing another public code while the one drawn is taken (ADR-0049). */
  async insert(create: (publicCode: PublicCode) => Order): Promise<Order> {
    for (let attempt = 1; ; attempt++) {
      const order = create(newPublicCode());
      if (await this.orders.insert(order)) return order;
      if (attempt === PUBLIC_CODE_ATTEMPTS) {
        throw new Error(`No free public code after ${attempt} attempts`);
      }
    }
  }
}
