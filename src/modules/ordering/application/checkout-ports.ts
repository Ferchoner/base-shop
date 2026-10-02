import type { Money } from '../../../shared-kernel/index.js';
import type {
  CartId,
  CustomerId,
  OrderId,
  OrderShipping,
  ReservationId,
  RestockLine,
  RestockReason,
  ShippingAddress,
  StaffId,
  VariantId,
  VariantOptions,
} from '../domain/order.js';
import type { LocationProblem } from '../domain/ordering-errors.js';

// Ordering's application layer cannot import other modules (ADR-0103): each port states what the checkout needs,
// and an adapter in Ordering's infrastructure answers it with the facade of the module that owns it (ADR-0005).
// Ordering uses Shopping, Catalog, Pricing, Inventory, Shipping, Identity and Geo, and none of them uses
// Ordering, so they never form a cycle (ADR-0132). Abstract classes rather than interfaces, so they can be the
// dependency injection tokens without depending on NestJS.

/** Whose cart a checkout uses: a guest cart, by its ID, or the active cart of the signed-in customer. */
export type CheckoutTarget =
  { readonly guestCartId: CartId } | { readonly customerId: CustomerId };

/** The variants and quantities of an active cart. */
export interface CheckoutCart {
  readonly id: CartId;
  /** Oldest first: the order numbers its lines in this order. */
  readonly lines: readonly StockLine[];
}

/** Units of a variant. */
export interface StockLine {
  readonly variantId: VariantId;
  readonly quantity: number;
}

/** The carts of Shopping. */
export abstract class CheckoutCarts {
  /**
   * The active cart to quote, without locking it; `null` when the customer has none.
   *
   * @throws NotFoundError for a guest cart that does not exist or has an owner; CartNotActiveError.
   */
  abstract toQuote(target: CheckoutTarget): Promise<CheckoutCart | null>;

  /** The same, locked until the transaction ends, so no change gets in between the quote and the order. */
  abstract lockToOrder(target: CheckoutTarget): Promise<CheckoutCart | null>;

  /** Leaves the locked cart CHECKED_OUT, in the transaction of the order (ADR-0019). */
  abstract checkOut(cartId: CartId): Promise<void>;
}

/** A variant as the order keeps it, and whether its product and the variant itself are on sale. */
export interface CheckoutVariant {
  readonly id: VariantId;
  readonly sku: string;
  readonly productName: string;
  readonly options: VariantOptions;
  /** Its product is published and the variant is active (BR-PRD-11). */
  readonly onSale: boolean;
}

/** The variants of Catalog. */
export abstract class CheckoutCatalog {
  /** The variants with these IDs, in any status; an unknown ID is left out. */
  abstract variants(
    ids: readonly VariantId[],
  ): Promise<ReadonlyMap<VariantId, CheckoutVariant>>;
}

/** The prices of Pricing, read without a cache (ADR-0028). */
export abstract class CheckoutPrices {
  /** The prices in force at `at`, VAT included; a variant without one is left out: it cannot be sold. */
  abstract current(
    ids: readonly VariantId[],
    at: Date,
  ): Promise<ReadonlyMap<VariantId, Money>>;
}

/** A reservation of the stock of an order, and when it ends. */
export interface StockReservation {
  readonly id: ReservationId;
  readonly expiresAt: Date;
}

/** The stock of Inventory, for the checkout and the life of an order. */
export abstract class OrderStock {
  /** Whether each variant can be fulfilled now, without revealing quantities (ADR-0061). */
  abstract canFulfill(
    lines: readonly StockLine[],
  ): Promise<ReadonlyMap<VariantId, boolean>>;

  /**
   * Reserves the units of the order, all or nothing, until the reservation expires (UC-INV-05, ADR-0128).
   *
   * @throws InsufficientStockError with every variant that cannot be fulfilled.
   */
  abstract reserve(
    orderId: OrderId,
    lines: readonly StockLine[],
  ): Promise<StockReservation>;

  /**
   * Like `reserve`, but `null` when some line is short, having reserved nothing, so the transaction of the
   * caller goes on (ADR-0133).
   */
  abstract reserveIfAvailable(
    orderId: OrderId,
    lines: readonly StockLine[],
  ): Promise<StockReservation | null>;

  /**
   * Confirms the reservation of a paid order: its units leave the stock (UC-INV-06). `not-active` when it has
   * no active reservation, such as an expired one.
   */
  abstract commit(
    orderId: OrderId,
  ): Promise<'committed' | 'already-committed' | 'not-active'>;

  /** Frees the reservation of an order (UC-INV-07); false when it has no active one. */
  abstract release(orderId: OrderId): Promise<boolean>;

  /** Ends the reservation of an order that was not paid in time (UC-INV-08); false when it has no active one. */
  abstract expire(orderId: OrderId): Promise<boolean>;

  /**
   * Brings units of lines of the order back to the stock (UC-INV-09, ADR-0052, ADR-0142), in the transaction of
   * the caller. Inventory counts what a line sold only once the stock of the order was confirmed, and never
   * brings a line back beyond it.
   *
   * @throws RestockLimitError, 409 `restock-not-allowed` with `lines`, when a line would come back beyond it.
   */
  abstract restock(input: {
    orderId: OrderId;
    reasonCode: RestockReason;
    note: string | null;
    actorId: StaffId;
    lines: readonly RestockLine[];
  }): Promise<RestockMovement[]>;
}

/** A RESTOCK movement Inventory wrote: `StockMovement` of API_SPEC.md §13. */
export interface RestockMovement {
  readonly id: string;
  readonly stockItemId: string;
  readonly type: string;
  readonly quantity: number;
  readonly onHandAfter: number;
  readonly reasonCode: string | null;
  readonly note: string | null;
  readonly orderId: string | null;
  readonly orderLineId: string | null;
  readonly actorId: string | null;
  readonly createdAt: Date;
}

/** The shipping of an order, and the amount from which it is free. */
export interface ShippingCharge extends OrderShipping {
  /** `null` when shipping is never free (ADR-0092). */
  readonly freeShippingThreshold: Money | null;
}

/** The shipping method of Shipping, read without a cache (ADR-0122). */
export abstract class CheckoutShipping {
  abstract quote(order: {
    readonly subtotal: Money;
    readonly discount: Money;
  }): Promise<ShippingCharge>;
}

/** The customers of Identity & Access. */
export abstract class CheckoutCustomers {
  /** The account email and whether it is verified; `null` unless it is an ACTIVE customer. */
  abstract contact(customerId: CustomerId): Promise<{
    readonly email: string;
    readonly emailVerified: boolean;
  } | null>;

  /** One of the customer's saved addresses; `null` when it does not exist or is another customer's. */
  abstract address(
    customerId: CustomerId,
    addressId: string,
  ): Promise<ShippingAddress | null>;
}

/** The names of a state and one of its municipalities, as the INEGI catalog has them. */
export interface LocationNames {
  readonly stateName: string;
  readonly municipalityName: string;
}

/** The geographic catalog of the `geo` module (ADR-0057), for the addresses that are not saved. */
export abstract class ShippingLocations {
  /** The names of the state and municipality, or what is wrong with them. */
  abstract resolve(
    stateCode: string,
    municipalityCode: string,
  ): Promise<LocationNames | LocationProblem>;
}
