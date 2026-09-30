import {
  DuplicateValueError,
  eventMetadata,
  InvalidStateTransitionError,
  InvalidValueError,
  NotFoundError,
} from '../../../shared-kernel/index.js';
import type { BrandId } from './brand.js';
import type { CatalogEvent } from './catalog-events.js';
import type { CategoryId } from './category.js';
import {
  FieldLockedError,
  NoActiveVariantError,
  OptionNamesMismatchError,
} from './product-errors.js';
import type { ProductId } from './product-id.js';
import { MAX_PRODUCT_SLUG_LENGTH, validSlug } from './slug.js';
import {
  optionNamesOf,
  sameOptions,
  validDimensions,
  validOptions,
  validSku,
  type VariantDimensions,
  type VariantId,
  type VariantOptions,
  type VariantSnapshot,
} from './variant.js';

export type ProductStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export const PRODUCT_STATUSES: readonly ProductStatus[] = [
  'DRAFT',
  'PUBLISHED',
  'ARCHIVED',
];

/** Limits of API_SPEC.md §11.6 and ADR-0123. */
export const MAX_TITLE_LENGTH = 200;
export const MAX_DESCRIPTION_LENGTH = 10_000;
export const MAX_CATEGORIES_PER_PRODUCT = 10;

export interface ProductSnapshot {
  readonly id: ProductId;
  readonly title: string;
  readonly slug: string;
  readonly description: string | null;
  readonly brandId: BrandId | null;
  readonly categoryIds: readonly CategoryId[];
  readonly status: ProductStatus;
  readonly publishedAt: Date | null;
  readonly archivedAt: Date | null;
  /** Set on the first publication and never again: from then on, slug, SKUs and options are fixed (ADR-0068). */
  readonly firstPublishedAt: Date | null;
  readonly variants: readonly VariantSnapshot[];
  readonly version: number;
}

/** The editable data of a product (UC-CAT-05). A missing field keeps its value. */
export interface ProductDetails {
  readonly title?: string;
  readonly slug?: string;
  readonly description?: string | null;
  readonly brandId?: BrandId | null;
  readonly categoryIds?: readonly CategoryId[];
}

/** A variant to add (UC-CAT-06). */
export interface NewVariant extends VariantDimensions {
  readonly id: VariantId;
  readonly sku: string;
  readonly options: Readonly<Record<string, unknown>>;
}

/** Changes to a variant (UC-CAT-07). A missing field keeps its value. */
export interface VariantChanges extends Partial<VariantDimensions> {
  readonly sku?: string;
  readonly options?: Readonly<Record<string, unknown>>;
}

/**
 * A product with its variants (ADR-0006, DATABASE.md §4.3 and §4.5): published only with an active variant
 * (BR-PRD-04), archived instead of deleted (BR-PRD-07) and reactivated to DRAFT (ADR-0076). Its slug, and the
 * SKUs and options of its variants, are fixed from the first publication (ADR-0068). An archived product
 * takes no change until it is reactivated (ADR-0123). Changes carry the product `version` (optimistic
 * locking); images come in T-140 part b.
 */
export class Product {
  private events: CatalogEvent[] = [];

  private constructor(private state: ProductSnapshot) {}

  /** A new product in DRAFT, without variants (UC-CAT-04, BR-PRD-09). */
  static create(props: {
    id: ProductId;
    title: string;
    slug: string;
    description: string | null;
    brandId: BrandId | null;
    categoryIds: readonly CategoryId[];
  }): Product {
    return new Product({
      id: props.id,
      title: validTitle(props.title),
      slug: validSlug(props.slug, MAX_PRODUCT_SLUG_LENGTH),
      description: validDescription(props.description),
      brandId: props.brandId,
      categoryIds: validCategories(props.categoryIds),
      status: 'DRAFT',
      publishedAt: null,
      archivedAt: null,
      firstPublishedAt: null,
      variants: [],
      version: 1,
    });
  }

  static restore(snapshot: ProductSnapshot): Product {
    return new Product(snapshot);
  }

  get id(): ProductId {
    return this.state.id;
  }

  get status(): ProductStatus {
    return this.state.status;
  }

  get version(): number {
    return this.state.version;
  }

  get brandId(): BrandId | null {
    return this.state.brandId;
  }

  get categoryIds(): readonly CategoryId[] {
    return this.state.categoryIds;
  }

  /** @throws FieldLockedError when the slug changes after the first publication. */
  editDetails(details: ProductDetails): void {
    this.assertEditable();
    const slug =
      details.slug === undefined
        ? this.state.slug
        : validSlug(details.slug, MAX_PRODUCT_SLUG_LENGTH);
    if (slug !== this.state.slug && this.state.firstPublishedAt !== null) {
      throw new FieldLockedError(['slug']);
    }
    this.state = {
      ...this.state,
      title:
        details.title === undefined
          ? this.state.title
          : validTitle(details.title),
      slug,
      description:
        details.description === undefined
          ? this.state.description
          : validDescription(details.description),
      brandId:
        details.brandId === undefined ? this.state.brandId : details.brandId,
      categoryIds:
        details.categoryIds === undefined
          ? this.state.categoryIds
          : validCategories(details.categoryIds),
    };
  }

  /**
   * Adds an active variant (UC-CAT-06): SKU unique in the product (the database checks the rest), the same
   * option names as the other variants, and a combination no other active variant has (BR-PRD-02).
   */
  addVariant(variant: NewVariant): void {
    this.assertEditable();
    const sku = validSku(variant.sku);
    const options = validOptions(variant.options);
    if (this.state.variants.some((other) => other.sku === sku)) {
      throw new DuplicateValueError('sku');
    }
    this.assertOptionNames(options);
    this.assertUniqueCombination(options);
    this.state = {
      ...this.state,
      variants: [
        ...this.state.variants,
        {
          id: variant.id,
          sku,
          options,
          status: 'ACTIVE',
          ...validDimensions(variant),
        },
      ],
    };
  }

  /**
   * Edits a variant (UC-CAT-07). SKU and options change only before the first publication, and the previous
   * SKU is then free again (ADR-0068); weight and sizes change always.
   */
  updateVariant(variantId: VariantId, changes: VariantChanges): void {
    this.assertEditable();
    const current = this.variant(variantId);
    const sku = changes.sku === undefined ? current.sku : validSku(changes.sku);
    const options =
      changes.options === undefined
        ? current.options
        : validOptions(changes.options);
    const locked = [
      ...(sku === current.sku ? [] : ['sku']),
      ...(sameOptions(options, current.options) ? [] : ['options']),
    ];
    if (locked.length > 0 && this.state.firstPublishedAt !== null) {
      throw new FieldLockedError(locked);
    }
    if (
      sku !== current.sku &&
      this.state.variants.some((other) => other.sku === sku)
    ) {
      throw new DuplicateValueError('sku');
    }
    if (!sameOptions(options, current.options)) {
      this.assertOptionNames(options, variantId);
      if (current.status === 'ACTIVE') {
        this.assertUniqueCombination(options, variantId);
      }
    }
    const dimensions = validDimensions({
      weightGrams: pick(changes.weightGrams, current.weightGrams),
      lengthCm: pick(changes.lengthCm, current.lengthCm),
      widthCm: pick(changes.widthCm, current.widthCm),
      heightCm: pick(changes.heightCm, current.heightCm),
    });
    this.replaceVariant({ ...current, sku, options, ...dimensions });
  }

  /** Stops selling a variant; it is never deleted (UC-CAT-08, BR-PRD-07). */
  discontinueVariant(variantId: VariantId, now: Date): void {
    this.assertEditable();
    const variant = this.variant(variantId);
    if (variant.status !== 'ACTIVE') {
      throw new InvalidStateTransitionError(variant.status, 'discontinue');
    }
    this.replaceVariant({ ...variant, status: 'DISCONTINUED' });
    this.events.push({
      ...eventMetadata('VariantDiscontinued', now),
      productId: this.state.id,
      variantId,
    });
  }

  /**
   * Sells a discontinued variant again, with the same SKU and options, unless another active variant has its
   * combination (UC-CAT-08, BR-PRD-13, ADR-0076).
   */
  reactivateVariant(variantId: VariantId): void {
    this.assertEditable();
    const variant = this.variant(variantId);
    if (variant.status !== 'DISCONTINUED') {
      throw new InvalidStateTransitionError(variant.status, 'reactivate');
    }
    this.assertUniqueCombination(variant.options, variantId);
    this.replaceVariant({ ...variant, status: 'ACTIVE' });
  }

  /**
   * Publishes a draft with at least one active variant, with or without price and images (UC-CAT-09,
   * BR-PRD-04, BR-PRD-05). The first publication fixes slug, SKUs and options (ADR-0068).
   */
  publish(now: Date): void {
    if (this.state.status !== 'DRAFT') {
      throw new InvalidStateTransitionError(this.state.status, 'publish');
    }
    if (!this.state.variants.some(({ status }) => status === 'ACTIVE')) {
      throw new NoActiveVariantError();
    }
    this.state = {
      ...this.state,
      status: 'PUBLISHED',
      publishedAt: now,
      firstPublishedAt: this.state.firstPublishedAt ?? now,
    };
    this.events.push({
      ...eventMetadata('ProductPublished', now),
      productId: this.state.id,
    });
  }

  /** Takes a draft or published product out of use; its slug stays reserved (UC-CAT-10, BR-PRD-09). */
  archive(now: Date): void {
    if (this.state.status === 'ARCHIVED') {
      throw new InvalidStateTransitionError(this.state.status, 'archive');
    }
    this.state = { ...this.state, status: 'ARCHIVED', archivedAt: now };
    this.events.push({
      ...eventMetadata('ProductArchived', now),
      productId: this.state.id,
    });
  }

  /**
   * Brings an archived product back as a draft, keeping its slug and first publication (UC-CAT-10, ADR-0076).
   * It shows in the store again only once published.
   */
  reactivate(): void {
    if (this.state.status !== 'ARCHIVED') {
      throw new InvalidStateTransitionError(this.state.status, 'reactivate');
    }
    this.state = {
      ...this.state,
      status: 'DRAFT',
      archivedAt: null,
      publishedAt: null,
    };
  }

  /** The events of the changes made, once: the use case publishes them after saving. */
  pullEvents(): CatalogEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }

  /** Called by the repository once a change is saved. */
  markSaved(version: number): void {
    this.state = { ...this.state, version };
  }

  snapshot(): ProductSnapshot {
    return this.state;
  }

  private assertEditable(): void {
    if (this.state.status === 'ARCHIVED') {
      throw new InvalidStateTransitionError(this.state.status, 'edit');
    }
  }

  private variant(variantId: VariantId): VariantSnapshot {
    const variant = this.state.variants.find(({ id }) => id === variantId);
    if (variant === undefined) throw new NotFoundError('Variant', variantId);
    return variant;
  }

  private replaceVariant(variant: VariantSnapshot): void {
    this.state = {
      ...this.state,
      variants: this.state.variants.map((other) =>
        other.id === variant.id ? variant : other,
      ),
    };
  }

  /**
   * The same option names as the other variants (API_SPEC.md §11.7). Once published, another set of names
   * would add or drop a dimension, which is locked (ADR-0068).
   */
  private assertOptionNames(options: VariantOptions, except?: VariantId): void {
    const others = this.state.variants.filter(({ id }) => id !== except);
    if (others.length === 0) return;
    const expected = optionNamesOf(others[0].options);
    if (expected.join('\u0000') === optionNamesOf(options).join('\u0000')) {
      return;
    }
    if (this.state.firstPublishedAt !== null) {
      throw new FieldLockedError(['options']);
    }
    throw new OptionNamesMismatchError(expected);
  }

  /** No other active variant with the same combination (BR-PRD-02); discontinued ones do not count. */
  private assertUniqueCombination(
    options: VariantOptions,
    except?: VariantId,
  ): void {
    const taken = this.state.variants.some(
      (other) =>
        other.id !== except &&
        other.status === 'ACTIVE' &&
        sameOptions(other.options, options),
    );
    if (taken) throw new DuplicateValueError('options');
  }
}

function pick<T>(change: T | undefined, current: T): T {
  return change === undefined ? current : change;
}

function validTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_TITLE_LENGTH) {
    throw new InvalidValueError(
      `A product title has 1 to ${MAX_TITLE_LENGTH} characters`,
    );
  }
  return trimmed;
}

/** Up to 10,000 characters; an empty description is no description. */
function validDescription(description: string | null): string | null {
  if (description === null || description.trim() === '') return null;
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    throw new InvalidValueError(
      `A description has at most ${MAX_DESCRIPTION_LENGTH} characters`,
    );
  }
  return description;
}

/** Without repeats, and at most 10 (ADR-0123). */
function validCategories(
  categoryIds: readonly CategoryId[],
): readonly CategoryId[] {
  const unique = [...new Set(categoryIds)];
  if (unique.length > MAX_CATEGORIES_PER_PRODUCT) {
    throw new InvalidValueError(
      `A product has at most ${MAX_CATEGORIES_PER_PRODUCT} categories`,
    );
  }
  return unique;
}
