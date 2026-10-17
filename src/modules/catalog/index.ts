// Public API of the Catalog context (ADR-0005): other modules import only from this file.
export { CatalogModule } from './catalog.module.js';
export {
  type CatalogEntries,
  type CatalogEntry,
  CatalogFacade,
  type VariantClassification,
  type VariantImage,
  type VariantSnapshot,
  type VariantWithImage,
} from './application/catalog.facade.js';
export type {
  CatalogEvent,
  ProductArchived,
  ProductPublished,
  ProductStoreOnlyChanged,
  VariantDiscontinued,
} from './domain/catalog-events.js';
export type { ProductId } from './domain/product-id.js';
export type { VariantId } from './domain/variant.js';
