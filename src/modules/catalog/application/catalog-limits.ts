// Limits of the domain that the API validates first: presentation cannot import the domain (ADR-0103).
export {
  CATALOG_STATUSES,
  type CatalogStatus,
  MAX_NAME_LENGTH,
} from '../domain/catalog-values.js';
export { MAX_POSITION } from '../domain/category.js';
export {
  MAX_ALT_TEXT_LENGTH,
  MAX_IMAGES_PER_PRODUCT,
} from '../domain/product-gallery.js';
export {
  MAX_CATEGORIES_PER_PRODUCT,
  MAX_DESCRIPTION_LENGTH,
  MAX_TITLE_LENGTH,
  PRODUCT_STATUSES,
  type ProductStatus,
} from '../domain/product.js';
export {
  MAX_PRODUCT_SLUG_LENGTH,
  MAX_SLUG_LENGTH,
  SLUG_PATTERN,
} from '../domain/slug.js';
export {
  MAX_DIMENSION_CM,
  MAX_WEIGHT_GRAMS,
  SKU_PATTERN,
  VARIANT_STATUSES,
} from '../domain/variant.js';
