import type { PromotionTarget } from '../domain/promotion.js';

/** A product, category or brand that a promotion targets, as Catalog gives it (ADR-0005). */
export interface CatalogTarget extends PromotionTarget {
  /** The title of the product, or the name of the category or the brand. */
  readonly name: string;
  /** A product that is not archived, or an active category or brand (ADR-0168). */
  readonly usable: boolean;
}

/** The products, categories and brands of Catalog, through its facade (ADR-0005). */
export abstract class PromotionCatalog {
  /** The ones that exist among these targets, with their name and whether they are in use; the others are left out. */
  abstract targets(
    targets: readonly PromotionTarget[],
  ): Promise<readonly CatalogTarget[]>;
}
