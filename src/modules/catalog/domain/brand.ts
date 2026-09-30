import {
  type Id,
  InvalidStateTransitionError,
} from '../../../shared-kernel/index.js';
import { type CatalogStatus, validName } from './catalog-values.js';
import { validSlug } from './slug.js';

export type BrandId = Id<'Brand'>;

export interface BrandSnapshot {
  readonly id: BrandId;
  readonly name: string;
  readonly slug: string;
  readonly status: CatalogStatus;
}

/**
 * A brand of the catalog (DATABASE.md §4.1). An inactive brand leaves the public list of brands, but its
 * products stay visible and keep showing it (ADR-0080). Brands have no `version`: the last change wins
 * (API_SPEC.md §11.9).
 */
export class Brand {
  private constructor(private state: BrandSnapshot) {}

  static create(props: { id: BrandId; name: string; slug: string }): Brand {
    return new Brand({
      id: props.id,
      name: validName(props.name),
      slug: validSlug(props.slug),
      status: 'ACTIVE',
    });
  }

  static restore(snapshot: BrandSnapshot): Brand {
    return new Brand(snapshot);
  }

  get id(): BrandId {
    return this.state.id;
  }

  rename(name: string): void {
    this.state = { ...this.state, name: validName(name) };
  }

  /** The previous slug stops working and is free again (ADR-0072). */
  changeSlug(slug: string): void {
    this.state = { ...this.state, slug: validSlug(slug) };
  }

  deactivate(): void {
    if (this.state.status !== 'ACTIVE') {
      throw new InvalidStateTransitionError(this.state.status, 'deactivate');
    }
    this.state = { ...this.state, status: 'INACTIVE' };
  }

  /** Without conditions (BR-PRD-13, ADR-0076). */
  reactivate(): void {
    if (this.state.status !== 'INACTIVE') {
      throw new InvalidStateTransitionError(this.state.status, 'reactivate');
    }
    this.state = { ...this.state, status: 'ACTIVE' };
  }

  snapshot(): BrandSnapshot {
    return this.state;
  }
}
