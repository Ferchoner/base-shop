import { Injectable } from '@nestjs/common';
import type { Money } from '../../../shared-kernel/index.js';
import { CatalogFacade } from '../../catalog/index.js';
import { InventoryFacade } from '../../inventory/index.js';
import { PricingFacade } from '../../pricing/index.js';
import {
  CartCatalog,
  CartPrices,
  CartStock,
  type CartVariant,
} from '../application/cart-ports.js';
import type { VariantId } from '../domain/cart.js';

/**
 * Shopping's ports answered with the facades of Catalog, Pricing and Inventory (ADR-0005, ADR-0131). Shopping
 * uses them, and none of them uses Shopping, so they never form a cycle.
 */
@Injectable()
export class CatalogFacadeCartCatalog extends CartCatalog {
  constructor(private readonly catalog: CatalogFacade) {
    super();
  }

  async variants(
    ids: readonly VariantId[],
  ): Promise<ReadonlyMap<VariantId, CartVariant>> {
    const variants = await this.catalog.variantsWithImage(ids);
    return new Map(
      variants.map((variant) => [
        variant.id,
        {
          id: variant.id,
          sku: variant.sku,
          options: variant.options,
          product: {
            id: variant.productId,
            slug: variant.productSlug,
            title: variant.productTitle,
          },
          image: variant.image,
          onSale:
            variant.productStatus === 'PUBLISHED' &&
            variant.status === 'ACTIVE',
        },
      ]),
    );
  }
}

@Injectable()
export class PricingFacadeCartPrices extends CartPrices {
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
export class InventoryFacadeCartStock extends CartStock {
  constructor(private readonly inventory: InventoryFacade) {
    super();
  }

  canFulfill(
    lines: readonly { variantId: VariantId; quantity: number }[],
  ): Promise<ReadonlyMap<VariantId, boolean>> {
    return this.inventory.canFulfill(lines);
  }
}
