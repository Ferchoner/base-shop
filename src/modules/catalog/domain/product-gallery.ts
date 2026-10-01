import {
  DomainError,
  type Id,
  InvalidStateTransitionError,
  InvalidValueError,
  NotFoundError,
} from '../../../shared-kernel/index.js';
import type { ProductStatus } from './product.js';
import type { ProductId } from './product-id.js';
import type { ImageContentType } from './product-image-file.js';
import type { VariantId } from './variant.js';

export type ProductImageId = Id<'ProductImage'>;

/** Most images a product keeps (ADR-0124). */
export const MAX_IMAGES_PER_PRODUCT = 20;

/** Longest alternative text of an image (API_SPEC.md §11.8). */
export const MAX_ALT_TEXT_LENGTH = 200;

export interface GalleryImage {
  readonly id: ProductImageId;
  readonly storageKey: string;
  readonly contentType: ImageContentType;
  readonly sizeBytes: number;
  readonly altText: string | null;
  readonly variantId: VariantId | null;
  /** From 1, consecutive: the order of the store. */
  readonly position: number;
}

/** A new image, already stored under its key (ADR-0121). */
export type NewGalleryImage = Omit<GalleryImage, 'position'>;

/** The product already has the most images allowed (ADR-0124). Answered 409 `image-limit-reached`. */
export class ImageLimitReachedError extends DomainError {
  readonly code = 'image-limit-reached';
  readonly category = 'conflict';

  constructor() {
    super(`A product keeps at most ${MAX_IMAGES_PER_PRODUCT} images`, {
      limit: MAX_IMAGES_PER_PRODUCT,
    });
  }
}

/** A value the API answers as a validation error of one field. */
abstract class GalleryFieldError extends DomainError {
  readonly code = 'validation-error';
  readonly category = 'invalid';

  protected constructor(field: string, code: string, message: string) {
    super(`${field}: ${code}`, { errors: [{ field, code, message }] });
  }
}

/** The variant of an image must be one of its product (API_SPEC.md §11.8). */
export class UnknownVariantError extends GalleryFieldError {
  constructor() {
    super('variantId', 'unknownVariant', 'La variante no es de este producto.');
  }
}

/** A new order lists every image of the product once (API_SPEC.md §11.8). */
export class ImageOrderError extends GalleryFieldError {
  constructor() {
    super(
      'imageIds',
      'imageOrder',
      'Debe incluir cada imagen del producto una sola vez.',
    );
  }
}

/**
 * The images of one product (UC-CAT-11, ADR-0124): a small aggregate of its own, so changing images never
 * conflicts with the `version` of the product (ADR-0071). Its positions go from 1 without gaps. An archived
 * product takes no change, as with its data and variants (ADR-0123).
 */
export class ProductGallery {
  private constructor(
    readonly productId: ProductId,
    private readonly productStatus: ProductStatus,
    private readonly variantIds: ReadonlySet<VariantId>,
    private list: GalleryImage[],
  ) {}

  static of(props: {
    productId: ProductId;
    productStatus: ProductStatus;
    variantIds: readonly VariantId[];
    images: readonly GalleryImage[];
  }): ProductGallery {
    return new ProductGallery(
      props.productId,
      props.productStatus,
      new Set(props.variantIds),
      [...props.images].sort((a, b) => a.position - b.position),
    );
  }

  /** The images in their order. */
  images(): readonly GalleryImage[] {
    return this.list;
  }

  /** Adds an image at the end (UC-CAT-11). */
  add(image: NewGalleryImage): GalleryImage {
    this.assertEditable();
    if (this.list.length >= MAX_IMAGES_PER_PRODUCT) {
      throw new ImageLimitReachedError();
    }
    this.assertVariant(image.variantId);
    const added: GalleryImage = {
      ...image,
      altText: validAltText(image.altText),
      position: this.list.length + 1,
    };
    this.list = [...this.list, added];
    return added;
  }

  /** Changes the alternative text or the variant of an image; a missing field keeps its value. */
  describe(
    imageId: ProductImageId,
    changes: { altText?: string | null; variantId?: VariantId | null },
  ): GalleryImage {
    this.assertEditable();
    const image = this.image(imageId);
    if (changes.variantId !== undefined) this.assertVariant(changes.variantId);
    const described: GalleryImage = {
      ...image,
      altText:
        changes.altText === undefined
          ? image.altText
          : validAltText(changes.altText),
      variantId:
        changes.variantId === undefined ? image.variantId : changes.variantId,
    };
    this.list = this.list.map((other) =>
      other.id === imageId ? described : other,
    );
    return described;
  }

  /** Puts the images in the given order, which lists each of them once. */
  reorder(imageIds: readonly ProductImageId[]): void {
    this.assertEditable();
    const byId = new Map(this.list.map((image) => [image.id, image]));
    if (
      imageIds.length !== this.list.length ||
      new Set(imageIds).size !== imageIds.length ||
      imageIds.some((id) => !byId.has(id))
    ) {
      throw new ImageOrderError();
    }
    this.list = imageIds.map((id, index) => ({
      ...(byId.get(id) as GalleryImage),
      position: index + 1,
    }));
  }

  /** Takes an image out, closing the gap it leaves; the caller deletes its file after the commit. */
  remove(imageId: ProductImageId): GalleryImage {
    this.assertEditable();
    const removed = this.image(imageId);
    this.list = this.list
      .filter(({ id }) => id !== imageId)
      .map((image, index) => ({ ...image, position: index + 1 }));
    return removed;
  }

  private image(imageId: ProductImageId): GalleryImage {
    const image = this.list.find(({ id }) => id === imageId);
    if (image === undefined) throw new NotFoundError('ProductImage', imageId);
    return image;
  }

  private assertVariant(variantId: VariantId | null): void {
    if (variantId !== null && !this.variantIds.has(variantId)) {
      throw new UnknownVariantError();
    }
  }

  private assertEditable(): void {
    if (this.productStatus === 'ARCHIVED') {
      throw new InvalidStateTransitionError(this.productStatus, 'edit');
    }
  }
}

/** Up to 200 characters; an empty text is no text. */
function validAltText(altText: string | null): string | null {
  if (altText === null) return null;
  const trimmed = altText.trim();
  if (trimmed.length > MAX_ALT_TEXT_LENGTH) {
    throw new InvalidValueError(
      `An alternative text has at most ${MAX_ALT_TEXT_LENGTH} characters`,
    );
  }
  return trimmed === '' ? null : trimmed;
}
