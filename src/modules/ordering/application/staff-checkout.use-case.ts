import { Inject, Injectable } from '@nestjs/common';
import {
  AuditTrail,
  changesBetween,
  Clock,
  DomainEventPublisher,
  InvalidValueError,
  newId,
  NotFoundError,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import {
  Order,
  type OrderDelivery,
  type OrderFulfillment,
  type OrderId,
  orderTotals,
  type StaffId,
  type WarehouseId,
} from '../domain/order.js';
import { OrderRepository } from '../domain/order.repository.js';
import {
  TotalMismatchError,
  VariantNotSellableError,
} from '../domain/ordering-errors.js';
import {
  CheckoutCatalog,
  CheckoutCustomers,
  CheckoutPrices,
  CheckoutShipping,
  OrderStock,
  ShippingLocations,
  type StockLine,
} from './checkout-ports.js';
import { orderPlaced } from './order-events.js';
import {
  type AddressChoice,
  type BuyerChoice,
  type CheckoutQuote,
  NO_SHIPPING,
  OrderPlacement,
} from './order-placement.js';
import {
  MAX_ORDER_LINE_QUANTITY,
  MAX_STAFF_ORDER_LINES,
} from './staff-order-limits.js';
import { VAT_RATE_BP } from './vat-rate.js';

/** UC-ORD-12: the lines the customer asks for in the store, and the warehouse they would come from. */
export interface StaffQuoteInput {
  /** From 1 to 100, each variant once with 1 to 30 units, in the order the order would number them. */
  readonly lines: readonly StockLine[];
  readonly warehouseId: WarehouseId;
  /** Shipped, or handed over in the store, without shipping (ADR-0161). */
  readonly fulfillment: OrderFulfillment;
}

/** UC-ORD-13: an order a staff member places on behalf of a customer who is in the store (ADR-0161). */
export interface StaffOrderInput extends StaffQuoteInput {
  readonly staffId: StaffId;
  /** `null` only for a sale handed over in the store, whose buyer gives no data. */
  readonly buyer: BuyerChoice | null;
  /** `null` exactly for an order handed over in the store. */
  readonly shippingAddress: AddressChoice | null;
  /** `grandTotal.amount` of the quote the customer accepted (ADR-0019). */
  readonly expectedTotal: number;
}

/**
 * The checkout of the staff in the physical store (UC-ORD-12 and 13, ADR-0161): the same prices, shipping and checks
 * as the online checkout, with the lines in the request instead of a cart, and the stock only from the warehouse the
 * staff chose. The order records who placed it, and placing it is audited as `orders.place`.
 */
@Injectable()
export class StaffCheckout {
  private readonly placement: OrderPlacement;

  constructor(
    catalog: CheckoutCatalog,
    prices: CheckoutPrices,
    private readonly stock: OrderStock,
    shipping: CheckoutShipping,
    customers: CheckoutCustomers,
    locations: ShippingLocations,
    orders: OrderRepository,
    private readonly transactions: TransactionManager,
    private readonly events: DomainEventPublisher,
    private readonly audit: AuditTrail,
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
   * What the order would cost now (UC-ORD-12), without changing anything: as the quote of a cart, with whether each
   * line can be fulfilled from the warehouse.
   *
   * @throws InvalidValueError for lines out of their limits or a variant twice; NotFoundError for a variant that
   *   does not exist, or a warehouse that does not exist or is not active.
   */
  async quote(input: StaffQuoteInput): Promise<CheckoutQuote> {
    assertLines(input.lines);
    await this.activeWarehouse(input.warehouseId);
    const assessment = await this.placement.assess(
      input.lines,
      this.clock.now(),
    );
    const available = await this.stock.canFulfill(
      assessment.priced.map(({ variantId, quantity }) => ({
        variantId,
        quantity,
      })),
      input.warehouseId,
    );
    const shipping =
      input.fulfillment === 'IN_STORE'
        ? NO_SHIPPING
        : await this.placement.quoteShipping(assessment.priced);
    return this.placement.quoteOf(assessment, available, shipping);
  }

  /**
   * Places the order (UC-ORD-13) in PENDING_PAYMENT, with its stock reserved in the warehouse until the reservation
   * expires, in one transaction. Checks, in this order: the buyer, the warehouse, the address, that every line can be
   * sold, the total and the stock.
   *
   * @throws InvalidValueError for lines out of their limits or a variant twice, an order to ship without a buyer or
   *   an address, or one handed over in the store with an address; EmailNotVerifiedError (BR-USR-05);
   *   NotFoundError for the customer, the warehouse, a saved address or a variant; InvalidShippingAddressError;
   *   VariantNotSellableError; TotalMismatchError (BR-ORD-06); InsufficientStockError with what the warehouse leaves
   *   out, reserving nothing (BR-INV-02).
   */
  async place(input: StaffOrderInput): Promise<OrderId> {
    assertLines(input.lines);
    assertDelivery(input);
    return this.transactions.run(async () => {
      const now = this.clock.now();
      const buyer = await this.placement.buyer(input.buyer);
      await this.activeWarehouse(input.warehouseId);
      const shippingAddress =
        input.shippingAddress === null
          ? null
          : await this.placement.shippingAddress(
              buyer.customerId,
              input.shippingAddress,
            );
      const { items, priced } = await this.placement.assess(input.lines, now);
      const unsellable = items
        .filter((item) => item.priced === null)
        .map(({ variant }) => variant.id);
      if (unsellable.length > 0) throw new VariantNotSellableError(unsellable);
      const delivery: OrderDelivery =
        shippingAddress === null
          ? { fulfillment: 'IN_STORE' }
          : {
              fulfillment: 'SHIPPING',
              shipping: await this.placement.quoteShipping(priced),
              shippingAddress,
            };
      const total = orderTotals(
        priced,
        delivery.fulfillment === 'SHIPPING' ? delivery.shipping : NO_SHIPPING,
      ).grandTotal;
      if (total.amount !== input.expectedTotal) {
        throw new TotalMismatchError(total);
      }
      const id = newId<'Order'>();
      const reservation = await this.stock.reserve(
        id,
        priced.map(({ variantId, quantity }) => ({ variantId, quantity })),
        input.warehouseId,
      );
      const order = await this.placement.insert((publicCode) =>
        Order.placeInStore({
          id,
          publicCode,
          buyer,
          lines: priced,
          delivery,
          reservation,
          placedBy: input.staffId,
          warehouseId: input.warehouseId,
          now,
        }),
      );
      // Only identifiers and the status: never the buyer's data (ADR-0037, ADR-0067).
      await this.audit.record({
        action: 'orders.place',
        resource: { type: 'order', id: order.id },
        changes: changesBetween(
          { status: null, channel: null, fulfillment: null, warehouseId: null },
          {
            status: order.status,
            channel: order.snapshot.channel,
            fulfillment: order.fulfillment,
            warehouseId: input.warehouseId,
          },
        ),
      });
      // The email of the received order (ADR-0074), once the order commits.
      this.events.publish(orderPlaced(order.id, now));
      return order.id;
    });
  }

  /** @throws NotFoundError unless the warehouse exists and is active; it stays locked until the transaction ends. */
  private async activeWarehouse(warehouseId: WarehouseId): Promise<void> {
    if (!(await this.stock.isActiveWarehouse(warehouseId))) {
      throw new NotFoundError('Warehouse', warehouseId);
    }
  }
}

/**
 * An order to ship has a buyer and an address; one handed over in the store has no address, and may have no buyer
 * (ADR-0161).
 *
 * @throws InvalidValueError otherwise.
 */
function assertDelivery(input: StaffOrderInput): void {
  if (input.fulfillment === 'SHIPPING') {
    if (input.buyer === null || input.shippingAddress === null) {
      throw new InvalidValueError(
        'An order to ship needs a buyer and an address',
      );
    }
  } else if (input.shippingAddress !== null) {
    throw new InvalidValueError(
      'An order handed over in the store has no address',
    );
  }
}

/**
 * @throws InvalidValueError for no lines or too many, a quantity out of 1 to 30, or a variant twice: each line is one
 *   variant of the order.
 */
function assertLines(lines: readonly StockLine[]): void {
  if (lines.length === 0 || lines.length > MAX_STAFF_ORDER_LINES) {
    throw new InvalidValueError(
      `An order has from 1 to ${MAX_STAFF_ORDER_LINES} lines`,
    );
  }
  for (const { quantity } of lines) {
    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > MAX_ORDER_LINE_QUANTITY
    ) {
      throw new InvalidValueError(
        `A line has from 1 to ${MAX_ORDER_LINE_QUANTITY} units`,
      );
    }
  }
  if (new Set(lines.map(({ variantId }) => variantId)).size !== lines.length) {
    throw new InvalidValueError('An order names each variant once');
  }
}
