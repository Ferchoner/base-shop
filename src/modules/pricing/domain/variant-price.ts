import {
  DomainError,
  type Id,
  type Money,
  NotFoundError,
} from '../../../shared-kernel/index.js';
import type { PriceListId } from './price-list.js';

export type VariantPriceId = Id<'VariantPrice'>;
export type PricePeriodId = Id<'PricePeriod'>;

/** A variant of Catalog, known here only by its ID (ADR-0005). */
export type VariantId = Id<'Variant'>;

/** A price of a variant for a span of time (DATABASE.md §5.3). */
export interface PricePeriod {
  readonly id: PricePeriodId;
  /** VAT included, as the list says (ADR-0008). */
  readonly amount: Money;
  /** The "before" price shown crossed out; always above `amount` (BR-PRC-03). */
  readonly compareAtAmount: Money | null;
  readonly effectiveFrom: Date;
  /** Where the next period begins; `null` while no later period exists. */
  readonly effectiveTo: Date | null;
  /** The staff member who set it. */
  readonly createdBy: string;
  readonly createdAt: Date;
}

export type PricePeriodState = 'PAST' | 'CURRENT' | 'SCHEDULED';

export const PRICE_PERIOD_STATES: readonly PricePeriodState[] = [
  'PAST',
  'CURRENT',
  'SCHEDULED',
];

/** Whether a period ended, is in force or has not begun at `at`. */
export function periodState(period: PricePeriod, at: Date): PricePeriodState {
  if (period.effectiveFrom > at) return 'SCHEDULED';
  return period.effectiveTo !== null && period.effectiveTo <= at
    ? 'PAST'
    : 'CURRENT';
}

/** Why a period cannot be added or cancelled (`reason` of the 409, ADR-0125). */
export type PricePeriodConflict = 'overlap' | 'already-started';

/**
 * Another period of the variant begins at the same instant, or the period to cancel already began
 * (BR-PRC-01, BR-PRC-04). Answered 409 `price-period-conflict` with `reason`.
 */
export class PricePeriodConflictError extends DomainError {
  readonly code = 'price-period-conflict';
  readonly category = 'conflict';

  constructor(reason: PricePeriodConflict) {
    super(
      reason === 'overlap'
        ? 'Another price period begins at the same instant'
        : 'The price period already began',
      { reason },
    );
  }
}

/** The compare-at price must be above the price (BR-PRC-03). Answered as a validation error of the field. */
export class CompareAtAmountError extends DomainError {
  readonly code = 'validation-error';
  readonly category = 'invalid';

  constructor() {
    super('The compare-at amount is not above the amount', {
      errors: [
        {
          field: 'compareAtAmount',
          code: 'compareAtAmount',
          message: 'Debe ser mayor que amount.',
        },
      ],
    });
  }
}

/** A price to set (UC-PRC-02) or schedule (UC-PRC-03). */
export interface NewPrice {
  readonly id: PricePeriodId;
  readonly amount: Money;
  readonly compareAtAmount: Money | null;
  /** `null`, or not after now: in force from now on. Later: scheduled for then. */
  readonly effectiveFrom: Date | null;
  readonly createdBy: string;
}

/** What setting a price did: open a period now, schedule one, or nothing, for the same current price. */
export type PriceChange = 'set' | 'scheduled' | 'unchanged';

/** The periods to write since the prices were loaded or saved. */
export interface PricePeriodChanges {
  readonly removed: readonly PricePeriodId[];
  /** Periods that began or were scheduled before, with a new end. */
  readonly ended: readonly PricePeriod[];
  readonly added: readonly PricePeriod[];
}

const sameMoney = (a: Money | null, b: Money | null) =>
  a === null || b === null ? a === b : a.equals(b);

/** The same price and compare-at price. */
const samePrice = (
  period: PricePeriod,
  price: Pick<NewPrice, 'amount' | 'compareAtAmount'>,
) =>
  period.amount.equals(price.amount) &&
  sameMoney(period.compareAtAmount, price.compareAtAmount);

/**
 * The prices of a variant in a list (DATABASE.md §5.2, ADR-0125). Its periods form one line without gaps
 * from the first one: each ends where the next begins, and the last one has no end.
 * - A new period closes the one it falls in at its start, and ends where the next one begins.
 * - Cancelling a scheduled period gives its time back to the period before it.
 * - A period that began never changes except for its end, and one that ended never changes (BR-PRC-04).
 */
export class VariantPrice {
  /** As loaded or last saved. */
  private saved: readonly PricePeriod[];

  private constructor(
    readonly id: VariantPriceId,
    readonly priceListId: PriceListId,
    readonly variantId: VariantId,
    private list: PricePeriod[],
  ) {
    this.saved = list;
  }

  static of(props: {
    id: VariantPriceId;
    priceListId: PriceListId;
    variantId: VariantId;
    periods: readonly PricePeriod[];
  }): VariantPrice {
    return new VariantPrice(
      props.id,
      props.priceListId,
      props.variantId,
      sortedByStart(props.periods),
    );
  }

  /** Oldest first. */
  periods(): readonly PricePeriod[] {
    return this.list;
  }

  /** The period in force at `at`, if any. */
  at(at: Date): PricePeriod | null {
    return (
      this.list.find((period) => periodState(period, at) === 'CURRENT') ?? null
    );
  }

  /**
   * Sets a price from now on (UC-PRC-02), or schedules it (UC-PRC-03). A price from now on equal to the
   * current one, or a scheduled price equal to the one scheduled at the same instant, opens no period and
   * answers the existing one (ADR-0126).
   *
   * @throws CompareAtAmountError when the compare-at price is not above the price.
   * @throws PricePeriodConflictError when another period, with another price, begins at the same instant.
   */
  set(
    price: NewPrice,
    now: Date,
  ): { period: PricePeriod; change: PriceChange } {
    if (
      price.compareAtAmount !== null &&
      !price.compareAtAmount.greaterThan(price.amount)
    ) {
      throw new CompareAtAmountError();
    }
    const scheduled = price.effectiveFrom !== null && price.effectiveFrom > now;
    const start =
      scheduled && price.effectiveFrom !== null ? price.effectiveFrom : now;
    const current = this.at(now);
    if (!scheduled && current !== null && samePrice(current, price)) {
      return { period: current, change: 'unchanged' };
    }
    const sameStart = this.list.find((period) =>
      sameInstant(period.effectiveFrom, start),
    );
    if (sameStart !== undefined) {
      // The same scheduled price again, as when a bulk import is repeated, changes nothing (ADR-0126).
      if (samePrice(sameStart, price)) {
        return { period: sameStart, change: 'unchanged' };
      }
      throw new PricePeriodConflictError('overlap');
    }
    const next = this.list.find((period) => period.effectiveFrom > start);
    const period: PricePeriod = {
      id: price.id,
      amount: price.amount,
      compareAtAmount: price.compareAtAmount,
      effectiveFrom: start,
      effectiveTo: next?.effectiveFrom ?? null,
      createdBy: price.createdBy,
      createdAt: now,
    };
    const containing = this.at(start);
    this.list = sortedByStart([
      ...this.list.map((each) =>
        each === containing ? { ...each, effectiveTo: start } : each,
      ),
      period,
    ]);
    return { period, change: scheduled ? 'scheduled' : 'set' };
  }

  /**
   * Cancels a scheduled period (UC-PRC-04, ADR-0038); the period before it, if any, lasts until the next one
   * again.
   *
   * @throws NotFoundError when the period is not one of this variant in this list.
   * @throws PricePeriodConflictError when the period already began (BR-PRC-04).
   */
  cancel(periodId: PricePeriodId, now: Date): PricePeriod {
    const period = this.list.find(({ id }) => id === periodId);
    if (period === undefined) throw new NotFoundError('PricePeriod', periodId);
    if (period.effectiveFrom <= now) {
      throw new PricePeriodConflictError('already-started');
    }
    this.list = this.list
      .filter((each) => each !== period)
      .map((each) =>
        each.effectiveTo !== null &&
        sameInstant(each.effectiveTo, period.effectiveFrom)
          ? { ...each, effectiveTo: period.effectiveTo }
          : each,
      );
    return period;
  }

  /** What changed since the prices were loaded or saved. */
  changes(): PricePeriodChanges {
    const before = new Map(this.saved.map((period) => [period.id, period]));
    const after = new Set(this.list.map(({ id }) => id));
    return {
      removed: this.saved
        .filter(({ id }) => !after.has(id))
        .map(({ id }) => id),
      ended: this.list.filter((period) => {
        const was = before.get(period.id);
        return (
          was !== undefined && !sameEnd(was.effectiveTo, period.effectiveTo)
        );
      }),
      added: this.list.filter(({ id }) => !before.has(id)),
    };
  }

  /** Called by the repository once the changes are written. */
  markSaved(): void {
    this.saved = this.list;
  }
}

function sameEnd(a: Date | null, b: Date | null): boolean {
  return a === null || b === null ? a === b : sameInstant(a, b);
}

function sameInstant(a: Date, b: Date): boolean {
  return a.getTime() === b.getTime();
}

function sortedByStart(periods: readonly PricePeriod[]): PricePeriod[] {
  return [...periods].sort(
    (a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime(),
  );
}
