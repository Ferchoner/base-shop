import { Injectable } from '@nestjs/common';
import type { VariantId } from '../domain/variant.js';
import { CatalogQueries, type VariantSnapshot } from './catalog.queries.js';
import { ProductImageStorage } from './product-image-storage.js';

export type { VariantSnapshot } from './catalog.queries.js';

/** An image as other contexts show it, with its absolute URL (ADR-0024). */
export interface VariantImage {
  readonly id: string;
  readonly url: string;
  readonly altText: string | null;
  readonly position: number;
  readonly variantId: VariantId | null;
}

/** A variant with the image that stands for it. */
export interface VariantWithImage extends VariantSnapshot {
  readonly image: VariantImage | null;
}

/**
 * Public API of Catalog for the other contexts (ADR-0005): snapshots of variants, read on every call. Pricing
 * checks with it that a variant exists before pricing it and finds variants by SKU for the bulk import
 * (T-145, ADR-0125, ADR-0126). Inventory checks variants and completes and searches its stock listing with
 * it (T-160, ADR-0127). The cart shows its lines with it (T-170, ADR-0131), and Ordering will take the SKU,
 * the options and the product from it.
 */
@Injectable()
export class CatalogFacade {
  constructor(
    private readonly queries: CatalogQueries,
    private readonly images: ProductImageStorage,
  ) {}

  /**
   * The variants with these IDs, in any status and ordered by SKU. An ID that does not exist is left out, so
   * the caller decides whether that is an error.
   */
  variants(ids: readonly VariantId[]): Promise<VariantSnapshot[]> {
    const unique = [...new Set(ids)];
    return unique.length === 0
      ? Promise.resolve([])
      : this.queries.findVariants(unique);
  }

  /**
   * The variants with these SKUs, whatever their case (SKUs are stored in uppercase, BR-PRD-09), in any status
   * and ordered by SKU. A SKU that does not exist is left out. The bulk import of prices uses it (ADR-0126).
   */
  variantsBySku(skus: readonly string[]): Promise<VariantSnapshot[]> {
    const unique = [...new Set(skus.map((sku) => sku.toUpperCase()))];
    return unique.length === 0
      ? Promise.resolve([])
      : this.queries.findVariantsBySku(unique);
  }

  /**
   * The variants with these IDs, as `variants` answers them, each with its main image (ADR-0131): the first
   * image of the variant, or else the first image of its product that belongs to no variant. The image in
   * position 1 is the main one, and the staff chooses it by reordering the gallery (ADR-0124). The cart shows
   * its lines with it (T-170).
   */
  async variantsWithImage(
    ids: readonly VariantId[],
  ): Promise<VariantWithImage[]> {
    const variants = await this.variants(ids);
    if (variants.length === 0) return [];
    const images = await this.queries.findImagesOfProducts([
      ...new Set(variants.map(({ productId }) => productId)),
    ]);
    return variants.map((variant) => {
      const image =
        images.find(({ variantId }) => variantId === variant.id) ??
        images.find(
          ({ productId, variantId }) =>
            productId === variant.productId && variantId === null,
        );
      return {
        ...variant,
        image:
          image === undefined
            ? null
            : {
                id: image.id,
                url: this.images.urlOf(image.storageKey),
                altText: image.altText,
                position: image.position,
                variantId: image.variantId,
              },
      };
    });
  }

  /**
   * The variants whose SKU or product title contains `text`, whatever its case, in any status and ordered by
   * SKU: the same search as the product listing. The stock listing of Inventory filters with it (ADR-0127).
   */
  searchVariants(text: string): Promise<VariantSnapshot[]> {
    const trimmed = text.trim();
    return trimmed === ''
      ? Promise.resolve([])
      : this.queries.searchVariants(trimmed);
  }
}
