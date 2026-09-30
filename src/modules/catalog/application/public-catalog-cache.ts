/**
 * Cache namespace of the public catalog reads (ADR-0028, ADR-0104): the category tree, and with T-140 the
 * product detail and listings. Presentation fills it and the Catalog event handler clears it.
 */
export const PUBLIC_CATALOG_CACHE = 'catalog';
