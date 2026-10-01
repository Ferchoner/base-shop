import { Injectable } from '@nestjs/common';
import type { Money } from '../../../shared-kernel/index.js';
import { CatalogFacade } from '../../catalog/index.js';
import { GeoCatalog } from '../../geo/index.js';
import { IdentityAccessFacade } from '../../identity-access/index.js';
import { DomainError } from '../../../shared-kernel/index.js';
import { InventoryFacade } from '../../inventory/index.js';
import { PricingFacade } from '../../pricing/index.js';
import { ShippingFacade } from '../../shipping/index.js';
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
  type ShippingCharge,
  ShippingLocations,
  type StockLine,
  type StockReservation,
} from '../application/checkout-ports.js';
import type {
  CartId,
  CustomerId,
  OrderId,
  ShippingAddress,
  VariantId,
} from '../domain/order.js';
import type { LocationProblem } from '../domain/ordering-errors.js';

// Ordering's ports answered with the facades of the modules that own the data (ADR-0005, ADR-0132). Ordering uses
// them, and none of them uses Ordering, so they never form a cycle.

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
  ): Promise<ReadonlyMap<VariantId, boolean>> {
    return this.inventory.canFulfill(lines);
  }

  async reserve(
    orderId: OrderId,
    lines: readonly StockLine[],
  ): Promise<StockReservation> {
    const receipt = await this.inventory.reserve(orderId, lines);
    return { id: receipt.reservationId, expiresAt: receipt.expiresAt };
  }

  async reserveIfAvailable(
    orderId: OrderId,
    lines: readonly StockLine[],
  ): Promise<StockReservation | null> {
    try {
      return await this.reserve(orderId, lines);
    } catch (error) {
      // InventoryFacade.reserve undid what it reserved before failing (ADR-0133).
      if (error instanceof DomainError && error.code === 'insufficient-stock') {
        return null;
      }
      throw error;
    }
  }

  commit(
    orderId: OrderId,
  ): Promise<'committed' | 'already-committed' | 'not-active'> {
    return this.inventory.commit(orderId);
  }

  release(orderId: OrderId): Promise<boolean> {
    return this.inventory.release(orderId);
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
