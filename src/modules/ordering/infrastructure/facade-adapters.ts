import { Injectable } from '@nestjs/common';
import { DomainError, type Money, toId } from '../../../shared-kernel/index.js';
import { CatalogFacade } from '../../catalog/index.js';
import { GeoCatalog } from '../../geo/index.js';
import { IdentityAccessFacade } from '../../identity-access/index.js';
import { InventoryFacade } from '../../inventory/index.js';
import {
  type PaymentRequest,
  PaymentsFacade,
  type PaymentView,
} from '../../payments/index.js';
import { PricingFacade } from '../../pricing/index.js';
import { ShippingFacade } from '../../shipping/index.js';
import {
  type OrderShipment,
  OrderShipments,
} from '../application/shipment-ports.js';
import { ShoppingFacade } from '../../shopping/index.js';
import {
  type CheckoutCart,
  CheckoutCarts,
  CheckoutCatalog,
  CheckoutCustomers,
  CheckoutPrices,
  CheckoutShipping,
  type CheckoutTarget,
  type CheckoutVariant,
  type LocationNames,
  OrderStock,
  type RestockMovement,
  type ShippingCharge,
  ShippingLocations,
  type StockLine,
  type StockReservation,
} from '../application/checkout-ports.js';
import type {
  CartId,
  CustomerId,
  Order,
  OrderAddress,
  OrderId,
  RestockLine,
  RestockReason,
  ShippingAddress,
  StaffId,
  VariantId,
  WarehouseId,
} from '../domain/order.js';
import type { LocationProblem } from '../domain/ordering-errors.js';
import {
  type OrderPayment,
  OrderPayments,
  type PaymentMethod,
  type PaymentProvider,
  type PaymentStart,
} from '../application/payment-ports.js';
import {
  type CartCopy,
  ReorderCarts,
  type ReorderLine,
} from '../application/reorder-ports.js';

// Ordering's ports answered with the facades of the modules that own the data (ADR-0005, ADR-0132). Ordering uses
// them, and none of them uses Ordering, so they never form a cycle.

@Injectable()
export class ShippingFacadeOrderShipments extends OrderShipments {
  constructor(
    private readonly shipping: ShippingFacade,
    private readonly inventory: InventoryFacade,
  ) {
    super();
  }

  async createFor(order: Order): Promise<void> {
    const { id, publicCode, lines } = order.snapshot;
    const allocation = await this.inventory.allocationOf(id);
    // One warehouse per order (ADR-0160): a second one would need a partial shipment, which is not enabled, and
    // the one shipment an order may have would leave it out.
    if (allocation.length !== 1) {
      throw new Error(
        `Order ${id} left ${allocation.length} warehouses; it needs exactly one (ADR-0160)`,
      );
    }
    await this.shipping.createShipment({
      orderId: id,
      orderCode: publicCode,
      warehouseId: allocation[0].warehouseId,
      destination: order.deliveryAddress,
      items: lines.map(({ id: orderLineId, sku, productName, quantity }) => ({
        orderLineId,
        sku,
        productName,
        quantity,
      })),
    });
  }

  cancel(orderId: OrderId): Promise<void> {
    return this.shipping.cancelShipmentOf(orderId);
  }

  anonymize(orderIds: readonly OrderId[], at: Date): Promise<void> {
    return this.shipping.anonymizeShipmentsOf(orderIds, at);
  }

  block(orderIds: readonly OrderId[], at: Date): Promise<void> {
    return this.shipping.blockShipmentsOf(orderIds, at);
  }

  destinationOf(orderId: OrderId): Promise<OrderAddress | null> {
    // Shipping keeps the address Ordering handed over, in the same format (ADR-0140).
    return this.shipping.destinationOf(orderId) as Promise<OrderAddress | null>;
  }

  shipmentsOf(
    orderIds: readonly OrderId[],
  ): Promise<ReadonlyMap<OrderId, OrderShipment>> {
    return this.shipping.shipmentsOf(orderIds) as Promise<
      ReadonlyMap<OrderId, OrderShipment>
    >;
  }
}

@Injectable()
export class ShoppingFacadeReorderCarts extends ReorderCarts {
  constructor(private readonly shopping: ShoppingFacade) {
    super();
  }

  copyToCustomerCart(
    customerId: CustomerId,
    lines: readonly ReorderLine[],
  ): Promise<CartCopy> {
    return this.shopping.copyToCustomerCart(customerId, lines);
  }

  copyToGuestCart(
    cartId: CartId | null,
    lines: readonly ReorderLine[],
  ): Promise<CartCopy> {
    return this.shopping.copyToGuestCart(cartId, lines);
  }

  copyToSourceCart(
    sourceCartId: CartId,
    lines: readonly ReorderLine[],
  ): Promise<CartCopy | null> {
    return this.shopping.copyToSourceCart(sourceCartId, lines);
  }
}

@Injectable()
export class ShoppingFacadeCheckoutCarts extends CheckoutCarts {
  constructor(private readonly shopping: ShoppingFacade) {
    super();
  }

  toQuote(target: CheckoutTarget): Promise<CheckoutCart | null> {
    return this.shopping.cartToQuote(target);
  }

  lockToOrder(target: CheckoutTarget): Promise<CheckoutCart | null> {
    return this.shopping.lockCartToOrder(target);
  }

  checkOut(cartId: CartId): Promise<void> {
    return this.shopping.checkOut(cartId);
  }
}

@Injectable()
export class CatalogFacadeCheckoutCatalog extends CheckoutCatalog {
  constructor(private readonly catalog: CatalogFacade) {
    super();
  }

  async variants(
    ids: readonly VariantId[],
  ): Promise<ReadonlyMap<VariantId, CheckoutVariant>> {
    const variants = await this.catalog.variants(ids);
    return new Map(
      variants.map((variant) => [
        variant.id,
        {
          id: variant.id,
          sku: variant.sku,
          productName: variant.productTitle,
          options: variant.options,
          onSale:
            variant.productStatus === 'PUBLISHED' &&
            variant.status === 'ACTIVE',
        },
      ]),
    );
  }
}

@Injectable()
export class PricingFacadeCheckoutPrices extends CheckoutPrices {
  constructor(private readonly pricing: PricingFacade) {
    super();
  }

  async current(
    ids: readonly VariantId[],
    at: Date,
  ): Promise<ReadonlyMap<VariantId, Money>> {
    const quotes = await this.pricing.quote(ids, at);
    return new Map(
      [...quotes].map(([variantId, quote]) => [variantId, quote.amount]),
    );
  }
}

@Injectable()
export class InventoryFacadeOrderStock extends OrderStock {
  constructor(private readonly inventory: InventoryFacade) {
    super();
  }

  canFulfill(
    lines: readonly StockLine[],
    warehouseId: WarehouseId | null = null,
  ): Promise<ReadonlyMap<VariantId, boolean>> {
    return this.inventory.canFulfillTogether(lines, warehouseId);
  }

  async reserve(
    orderId: OrderId,
    lines: readonly StockLine[],
    warehouseId: WarehouseId | null = null,
  ): Promise<StockReservation> {
    const receipt = await this.inventory.reserve(orderId, lines, warehouseId);
    return { id: receipt.reservationId, expiresAt: receipt.expiresAt };
  }

  async reserveIfAvailable(
    orderId: OrderId,
    lines: readonly StockLine[],
    warehouseId: WarehouseId | null = null,
  ): Promise<StockReservation | null> {
    try {
      return await this.reserve(orderId, lines, warehouseId);
    } catch (error) {
      // InventoryFacade.reserve undid what it reserved before failing (ADR-0133).
      if (error instanceof DomainError && error.code === 'insufficient-stock') {
        return null;
      }
      throw error;
    }
  }

  isActiveWarehouse(warehouseId: WarehouseId): Promise<boolean> {
    return this.inventory.isActiveWarehouse(warehouseId);
  }

  commit(
    orderId: OrderId,
  ): Promise<'committed' | 'already-committed' | 'not-active'> {
    return this.inventory.commit(orderId);
  }

  release(orderId: OrderId): Promise<boolean> {
    return this.inventory.release(orderId);
  }

  expire(orderId: OrderId): Promise<boolean> {
    return this.inventory.expire(orderId);
  }

  restock(input: {
    orderId: OrderId;
    reasonCode: RestockReason;
    note: string | null;
    actorId: StaffId;
    lines: readonly RestockLine[];
    warehouseId: WarehouseId | null;
  }): Promise<RestockMovement[]> {
    return this.inventory.restock(input);
  }
}

@Injectable()
export class ShippingFacadeCheckoutShipping extends CheckoutShipping {
  constructor(private readonly shipping: ShippingFacade) {
    super();
  }

  async quote(order: {
    subtotal: Money;
    discount: Money;
  }): Promise<ShippingCharge> {
    const quote = await this.shipping.quote(order);
    return {
      cost: quote.cost,
      taxAmount: quote.taxAmount,
      taxRateBp: quote.taxRateBp,
      freeShippingThreshold: quote.freeShippingThreshold,
      deliveryMinBusinessDays: quote.deliveryMinBusinessDays,
      deliveryMaxBusinessDays: quote.deliveryMaxBusinessDays,
    };
  }
}

@Injectable()
export class IdentityFacadeCheckoutCustomers extends CheckoutCustomers {
  constructor(private readonly identity: IdentityAccessFacade) {
    super();
  }

  contact(
    customerId: CustomerId,
  ): Promise<{ email: string; emailVerified: boolean } | null> {
    return this.identity.customerContact(customerId);
  }

  async address(
    customerId: CustomerId,
    addressId: string,
  ): Promise<ShippingAddress | null> {
    const address = await this.identity.customerAddress(customerId, addressId);
    return address === null ? null : { ...address, country: 'MX' };
  }
}

/** The same rules as the addresses of customers (ADR-0113) and of the warehouse (ADR-0127). */
@Injectable()
export class GeoShippingLocations extends ShippingLocations {
  constructor(private readonly geo: GeoCatalog) {
    super();
  }

  async resolve(
    stateCode: string,
    municipalityCode: string,
  ): Promise<LocationNames | LocationProblem> {
    const state = await this.geo.findState(stateCode);
    if (state === null) return 'unknown-state';
    const municipality = await this.geo.findMunicipality(municipalityCode);
    if (municipality === null || municipality.stateCode !== stateCode) {
      return 'municipality-not-in-state';
    }
    if (!municipality.isActive) return 'inactive-municipality';
    return { stateName: state.name, municipalityName: municipality.name };
  }
}

/** Ordering uses Payments, and Payments never uses Ordering (ADR-0134). */
@Injectable()
export class PaymentsFacadeOrderPayments extends OrderPayments {
  constructor(private readonly payments: PaymentsFacade) {
    super();
  }

  assertManualCaptureEnabled(): Promise<void> {
    return this.payments.assertManualPaymentsEnabled();
  }

  assertProviderEnabled(provider: PaymentProvider): Promise<void> {
    return this.payments.assertProviderEnabled(provider);
  }

  async start(order: Order, provider: PaymentProvider): Promise<PaymentStart> {
    const start = await this.payments.start(requestOf(order), provider);
    return { ...start, payment: toOrderPayment(start.payment) };
  }

  captureManually(
    order: Order,
    input: {
      reference: string;
      method: PaymentMethod | null;
      note: string | null;
      registeredBy: StaffId;
    },
  ): Promise<void> {
    return this.payments.captureManually(requestOf(order), input);
  }

  startRefund(orderId: OrderId): Promise<void> {
    return this.payments.startRefund(orderId);
  }

  cancelPending(orderId: OrderId): Promise<void> {
    return this.payments.cancelPending(orderId);
  }

  async paymentsOf(
    orderIds: readonly OrderId[],
  ): Promise<ReadonlyMap<OrderId, OrderPayment>> {
    const payments = await this.payments.paymentsOf(orderIds);
    return new Map(
      [...payments].map(([orderId, payment]) => [
        toId<'Order'>(orderId),
        toOrderPayment(payment),
      ]),
    );
  }
}

/** The order as Payments needs it: its total is the amount to collect (BR-PAY-02). */
function requestOf(order: Order): PaymentRequest {
  return {
    orderId: order.id,
    orderCode: order.publicCode,
    amount: order.grandTotal,
  };
}

function toOrderPayment(payment: PaymentView): OrderPayment {
  return {
    id: payment.id,
    provider: payment.provider,
    status: payment.status,
    amount: payment.amount,
    capturedAmount: payment.capturedAmount,
    refundedAmount: payment.refundedAmount,
    capturedAt: payment.capturedAt,
    method: payment.method,
    refunds: payment.refunds.map(
      ({ id, amount, status, createdAt, completedAt }) => ({
        id,
        amount,
        status,
        createdAt,
        completedAt,
      }),
    ),
  };
}
