/**
 * Cache namespace of the public catalog reads (ADR-0028, ADR-0104, ADR-0129): the category tree, the brands,
 * the product detail and the listings without search text. Presentation fills it and the Catalog event
 * handler clears it.
 */
export const PUBLIC_CATALOG_CACHE = 'catalog';
