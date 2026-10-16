import type { DomainEvent } from '../../../shared-kernel/index.js';
import type { ProductId } from './product-id.js';
import type { VariantId } from './variant.js';

/** A product was published and can show in the store (UC-CAT-09). Clears the public catalog cache. */
export interface ProductPublished extends DomainEvent<'ProductPublished'> {
  readonly productId: ProductId;
}

/** A product was archived and leaves the store (UC-CAT-10). Clears the public catalog cache. */
export interface ProductArchived extends DomainEvent<'ProductArchived'> {
  readonly productId: ProductId;
}

/** A variant was discontinued and is no longer sellable (UC-CAT-08). Clears the public catalog cache. */
export interface VariantDiscontinued extends DomainEvent<'VariantDiscontinued'> {
  readonly productId: ProductId;
  readonly variantId: VariantId;
}

/**
 * A published product became sold only in the physical store, or online too (ADR-0165): it leaves the store or comes
 * back. Clears the public catalog cache.
 */
export interface ProductStoreOnlyChanged extends DomainEvent<'ProductStoreOnlyChanged'> {
  readonly productId: ProductId;
  readonly storeOnly: boolean;
}

export type CatalogEvent =
  | ProductPublished
  | ProductArchived
  | VariantDiscontinued
  | ProductStoreOnlyChanged;
