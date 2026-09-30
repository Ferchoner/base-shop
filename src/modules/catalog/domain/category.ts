import {
  type Id,
  InvalidStateTransitionError,
  InvalidValueError,
} from '../../../shared-kernel/index.js';
import { CategoryCycleError, InactiveParentError } from './catalog-errors.js';
import { type CatalogStatus, validName } from './catalog-values.js';
import { validSlug } from './slug.js';

export type CategoryId = Id<'Category'>;

/** Highest `position` of a category among its siblings (API_SPEC.md §11.9). */
export const MAX_POSITION = 10_000;

export interface CategorySnapshot {
  readonly id: CategoryId;
  /** `null` for a root category. */
  readonly parentId: CategoryId | null;
  readonly name: string;
  readonly slug: string;
  readonly status: CatalogStatus;
  /** Order among its siblings; ties go by name. */
  readonly position: number;
}

/**
 * A category of the catalog tree (ADR-0006, DATABASE.md §4.2). It is visible in the store only while it and
 * every ancestor are active (BR-PRD-17, ADR-0080). Categories have no `version`: the last change wins
 * (API_SPEC.md §11.9).
 */
export class Category {
  private constructor(private state: CategorySnapshot) {}

  /** A new active category. Its parent, if any, is checked by the caller: it must exist and be active. */
  static create(props: {
    id: CategoryId;
    parentId: CategoryId | null;
    name: string;
    slug: string;
    position: number;
  }): Category {
    return new Category({
      id: props.id,
      parentId: props.parentId,
      name: validName(props.name),
      slug: validSlug(props.slug),
      status: 'ACTIVE',
      position: validPosition(props.position),
    });
  }

  static restore(snapshot: CategorySnapshot): Category {
    return new Category(snapshot);
  }

  get id(): CategoryId {
    return this.state.id;
  }

  get parentId(): CategoryId | null {
    return this.state.parentId;
  }

  get status(): CatalogStatus {
    return this.state.status;
  }

  rename(name: string): void {
    this.state = { ...this.state, name: validName(name) };
  }

  /** The previous slug stops working and is free again (ADR-0072). */
  changeSlug(slug: string): void {
    this.state = { ...this.state, slug: validSlug(slug) };
  }

  reposition(position: number): void {
    this.state = { ...this.state, position: validPosition(position) };
  }

  /**
   * Moves the category under `parentId`, or to the root with `null`. `parentLineage` holds the new parent
   * and each of its ancestors up to the root: if it holds this category, the move would create a cycle
   * (BR-PRD-03).
   */
  moveUnder(
    parentId: CategoryId | null,
    parentLineage: readonly CategoryId[],
  ): void {
    if (parentId === this.state.id || parentLineage.includes(this.state.id)) {
      throw new CategoryCycleError();
    }
    this.state = { ...this.state, parentId };
  }

  /** Hides the category and its whole subtree in the store; its subcategories keep their status (ADR-0080). */
  deactivate(): void {
    if (this.state.status !== 'ACTIVE') {
      throw new InvalidStateTransitionError(this.state.status, 'deactivate');
    }
    this.state = { ...this.state, status: 'INACTIVE' };
  }

  /**
   * Only under an active parent or as a root, and without reactivating its subcategories (BR-PRD-13,
   * ADR-0076). `parentStatus` is `null` for a root category.
   */
  reactivate(parentStatus: CatalogStatus | null): void {
    if (this.state.status !== 'INACTIVE') {
      throw new InvalidStateTransitionError(this.state.status, 'reactivate');
    }
    if (parentStatus === 'INACTIVE') throw new InactiveParentError();
    this.state = { ...this.state, status: 'ACTIVE' };
  }

  snapshot(): CategorySnapshot {
    return this.state;
  }
}

function validPosition(position: number): number {
  if (!Number.isInteger(position) || position < 0 || position > MAX_POSITION) {
    throw new InvalidValueError(
      `A position is an integer from 0 to ${MAX_POSITION}`,
    );
  }
  return position;
}
