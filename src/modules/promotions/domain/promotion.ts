import {
  type Id,
  InvalidStateTransitionError,
  InvalidValueError,
  type Money,
} from '../../../shared-kernel/index.js';
import { PromotionEndError } from './promotion-errors.js';

export type PromotionId = Id<'Promotion'>;

/** A staff member of Identity, known here only by its ID (ADR-0005). */
export type UserId = Id<'User'>;

/** Where a promotion applies (ADR-0168): online, in the physical store, or both. */
export type PromotionChannel = 'ONLINE' | 'STORE';

export const PROMOTION_CHANNELS: readonly PromotionChannel[] = [
  'ONLINE',
  'STORE',
];

/** What a promotion can be limited to (ADR-0168): products, categories with their subcategories, or brands. */
export type PromotionTargetType = 'PRODUCT' | 'CATEGORY' | 'BRAND';

export const PROMOTION_TARGET_TYPES: readonly PromotionTargetType[] = [
  'PRODUCT',
  'CATEGORY',
  'BRAND',
];

/** Where a promotion is in its time (ADR-0168), from its dates: it is never stored. */
export type PromotionStatus = 'SCHEDULED' | 'ACTIVE' | 'ENDED';

export const PROMOTION_STATUSES: readonly PromotionStatus[] = [
  'SCHEDULED',
  'ACTIVE',
  'ENDED',
];

/** Limits of a promotion (API_SPEC.md §26.2). */
export const PROMOTION_LIMITS = {
  name: 120,
  targets: 100,
  /** Whole percentages, up to the whole price (ADR-0168). */
  percentage: 100,
} as const;

/** A product, category or brand of Catalog, known here only by its type and ID (ADR-0005). */
export interface PromotionTarget {
  readonly type: PromotionTargetType;
  readonly id: string;
}

/**
 * What a promotion takes off (ADR-0168): a whole percentage of the lines it applies to, or a fixed amount once per
 * order, split among them.
 */
export type Discount =
  | { readonly type: 'PERCENTAGE'; readonly percentage: number }
  | { readonly type: 'AMOUNT'; readonly amount: Money };

/** What the staff decides of a promotion (UC-PRM-01 and 03). */
export interface PromotionTerms {
  /** The customer sees it on their order and on the ticket. */
  readonly name: string;
  readonly discount: Discount;
  /** Empty: the whole purchase. */
  readonly targets: readonly PromotionTarget[];
  /** One or both, in the order of `PROMOTION_CHANNELS`. */
  readonly channels: readonly PromotionChannel[];
  /** Of the subtotal of the order, with VAT. */
  readonly minimumSubtotal: Money | null;
  readonly startsAt: Date;
  /** `null`: it has no planned end. */
  readonly endsAt: Date | null;
}

/** The terms of a new promotion: without a start, it starts when it is created. */
export interface NewPromotionTerms extends Omit<PromotionTerms, 'startsAt'> {
  readonly startsAt: Date | null;
}

/** Changes to a promotion (UC-PRM-03). A missing field keeps its value; `null` clears an optional one. */
export type PromotionChanges = Partial<PromotionTerms>;

export interface PromotionSnapshot extends PromotionTerms {
  readonly id: PromotionId;
  readonly createdBy: UserId;
  /** When it was ended by hand, before or after it started, and who ended it. */
  readonly endedAt: Date | null;
  readonly endedBy: UserId | null;
  readonly version: number;
}

/** The terms that change only before a promotion starts (ADR-0168): once it started, only its name and its end do. */
const LOCKED_ONCE_STARTED = [
  'discount',
  'targets',
  'channels',
  'minimumSubtotal',
  'startsAt',
] as const;

/**
 * The status of a promotion with these dates at `at` (ADR-0168): SCHEDULED before it starts; ACTIVE from its start
 * until its end, excluded; ENDED from then, or since it was ended by hand.
 */
export function promotionStatus(
  dates: {
    readonly startsAt: Date;
    readonly endsAt: Date | null;
    readonly endedAt: Date | null;
  },
  at: Date,
): PromotionStatus {
  if (dates.endedAt !== null || (dates.endsAt !== null && dates.endsAt <= at)) {
    return 'ENDED';
  }
  return at < dates.startsAt ? 'SCHEDULED' : 'ACTIVE';
}

/**
 * A promotion (ADR-0168): a percentage or an amount off the whole purchase or certain products, categories or brands,
 * online, in the store or both, with an optional minimum purchase, from its start to its end. Before it starts,
 * everything changes; once started, only its name and its end, or it is ended; ended, nothing changes. Nothing is
 * deleted, since orders keep which promotion they got. Changes carry the `version` (optimistic locking).
 */
export class Promotion {
  private targetsWereChanged = false;

  private constructor(private state: PromotionSnapshot) {}

  /**
   * A new promotion (UC-PRM-01). A start that is missing or already past is `at`, as with a price (ADR-0125).
   *
   * @throws InvalidValueError; PromotionEndError when the end is not after the start.
   */
  static create(props: {
    id: PromotionId;
    terms: NewPromotionTerms;
    createdBy: UserId;
    at: Date;
  }): Promotion {
    const startsAt =
      props.terms.startsAt === null || props.terms.startsAt < props.at
        ? props.at
        : props.terms.startsAt;
    return new Promotion({
      id: props.id,
      ...validTerms({ ...props.terms, startsAt }),
      createdBy: props.createdBy,
      endedAt: null,
      endedBy: null,
      version: 1,
    });
  }

  static restore(snapshot: PromotionSnapshot): Promotion {
    return new Promotion(snapshot);
  }

  get id(): PromotionId {
    return this.state.id;
  }

  get version(): number {
    return this.state.version;
  }

  get snapshot(): PromotionSnapshot {
    return this.state;
  }

  /** Whether `edit` changed its products, categories or brands since it was read. */
  get targetsChanged(): boolean {
    return this.targetsWereChanged;
  }

  statusAt(at: Date): PromotionStatus {
    return promotionStatus(this.state, at);
  }

  /**
   * Changes its terms (UC-PRM-03). A scheduled promotion given a start that is already past starts at `at`.
   *
   * @throws InvalidStateTransitionError when it ended, or when it started and the change is to another term than its
   *   name and its end; PromotionEndError when the end is not after the start, or, once started, not after `at`;
   *   InvalidValueError.
   */
  edit(changes: PromotionChanges, at: Date): void {
    const status = this.statusAt(at);
    if (status === 'ENDED') {
      throw new InvalidStateTransitionError(status, 'edit');
    }
    const defined = Object.fromEntries(
      Object.entries(changes).filter(([, value]) => value !== undefined),
    ) as PromotionChanges;
    // A started promotion keeps its start: only a scheduled one moves a past start to now.
    const startsAt =
      status === 'SCHEDULED' &&
      defined.startsAt !== undefined &&
      defined.startsAt < at
        ? at
        : (defined.startsAt ?? this.state.startsAt);
    const next = validTerms({ ...this.state, ...defined, startsAt });
    if (status === 'ACTIVE') {
      const locked = LOCKED_ONCE_STARTED.find(
        (term) => !sameTerm(term, this.state, next),
      );
      if (locked !== undefined) {
        throw new InvalidStateTransitionError(status, `change its ${locked}`);
      }
      if (next.endsAt !== null && next.endsAt <= at) {
        throw new PromotionEndError('inFuture');
      }
    }
    // The same targets in another order are no change: they keep the order they had.
    const sameTargets = sameTerm('targets', this.state, next);
    this.targetsWereChanged ||= !sameTargets;
    this.state = {
      ...this.state,
      ...next,
      targets: sameTargets ? this.state.targets : next.targets,
    };
  }

  /**
   * Ends it now (UC-PRM-03): an active promotion stops applying, and a scheduled one never starts.
   *
   * @throws InvalidStateTransitionError when it ended already.
   */
  end(staffId: UserId, at: Date): void {
    const status = this.statusAt(at);
    if (status === 'ENDED') {
      throw new InvalidStateTransitionError(status, 'end');
    }
    this.state = { ...this.state, endedAt: at, endedBy: staffId };
  }
}

/** Whether a term is the same in both versions of the terms. */
function sameTerm(
  term: (typeof LOCKED_ONCE_STARTED)[number] | 'targets',
  before: PromotionTerms,
  after: PromotionTerms,
): boolean {
  switch (term) {
    case 'discount':
      return keyOfDiscount(before.discount) === keyOfDiscount(after.discount);
    case 'targets':
      return (
        keysOfTargets(before.targets).join() ===
        keysOfTargets(after.targets).join()
      );
    case 'channels':
      return before.channels.join() === after.channels.join();
    case 'minimumSubtotal':
      return (
        (before.minimumSubtotal?.amount ?? null) ===
        (after.minimumSubtotal?.amount ?? null)
      );
    case 'startsAt':
      return before.startsAt.getTime() === after.startsAt.getTime();
  }
}

function keyOfDiscount(discount: Discount): string {
  return discount.type === 'PERCENTAGE'
    ? `PERCENTAGE ${discount.percentage}`
    : `AMOUNT ${discount.amount.amount}`;
}

/** The targets as `TYPE:id`, sorted, to compare them as sets. */
function keysOfTargets(targets: readonly PromotionTarget[]): string[] {
  return targets.map(({ type, id }) => `${type}:${id}`).sort();
}

/** The terms with the name trimmed, the channels in their order, and every rule checked. */
function validTerms(terms: PromotionTerms): PromotionTerms {
  const name = terms.name.trim();
  if (name.length === 0 || name.length > PROMOTION_LIMITS.name) {
    throw new InvalidValueError(
      `A name has 1 to ${PROMOTION_LIMITS.name} characters`,
    );
  }
  const keys = keysOfTargets(terms.targets);
  if (keys.length > PROMOTION_LIMITS.targets) {
    throw new InvalidValueError(
      `A promotion has at most ${PROMOTION_LIMITS.targets} targets`,
    );
  }
  if (new Set(keys).size !== keys.length) {
    throw new InvalidValueError('A promotion has each target once');
  }
  const channels = PROMOTION_CHANNELS.filter((channel) =>
    terms.channels.includes(channel),
  );
  if (channels.length === 0) {
    throw new InvalidValueError('A promotion applies in some channel');
  }
  if (terms.minimumSubtotal !== null && terms.minimumSubtotal.amount < 1) {
    throw new InvalidValueError('A minimum purchase is more than 0');
  }
  if (terms.endsAt !== null && terms.endsAt <= terms.startsAt) {
    throw new PromotionEndError('afterStart');
  }
  return {
    name,
    discount: validDiscount(terms.discount),
    targets: terms.targets,
    channels,
    minimumSubtotal: terms.minimumSubtotal,
    startsAt: terms.startsAt,
    endsAt: terms.endsAt,
  };
}

function validDiscount(discount: Discount): Discount {
  if (discount.type === 'AMOUNT') {
    if (discount.amount.amount < 1) {
      throw new InvalidValueError('A discount is more than 0');
    }
    return discount;
  }
  if (
    !Number.isInteger(discount.percentage) ||
    discount.percentage < 1 ||
    discount.percentage > PROMOTION_LIMITS.percentage
  ) {
    throw new InvalidValueError(
      `A percentage is a whole number from 1 to ${PROMOTION_LIMITS.percentage}`,
    );
  }
  return discount;
}
