// Limits of the domain that the API validates first: presentation cannot import the domain (ADR-0103).
export {
  CATALOG_STATUSES,
  type CatalogStatus,
  MAX_NAME_LENGTH,
} from '../domain/catalog-values.js';
export { MAX_POSITION } from '../domain/category.js';
export { MAX_SLUG_LENGTH, SLUG_PATTERN } from '../domain/slug.js';
