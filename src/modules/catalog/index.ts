// Public API of the Catalog context (ADR-0005): other modules import only from this file.
export { CatalogModule } from './catalog.module.js';
export type {
  CatalogEvent,
  ProductArchived,
  ProductPublished,
  VariantDiscontinued,
} from './domain/catalog-events.js';
export type { ProductId } from './domain/product-id.js';
export type { VariantId } from './domain/variant.js';
