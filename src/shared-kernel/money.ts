import { InvalidValueError } from './domain-error.js';

/** Currencies in operation: only MXN (ADR-0026). Adding one means widening this type. */
export type Currency = 'MXN';

/** Largest amount a money column can hold: PostgreSQL `integer`, 21,474,836.47 (ADR-0066). */
export const MAX_MONEY_AMOUNT = 2_147_483_647;

/** Largest tax rate accepted: 100% in basis points. */
const MAX_TAX_RATE_BASIS_POINTS = 10_000;

/**
 * An amount of money in cents with its currency (ADR-0007). Immutable; never negative, because every
 * amount in the data model is zero or more (ADR-0066).
 */
export class Money {
  private constructor(
    readonly amount: number,
    readonly currency: Currency,
  ) {}

  /** @throws InvalidValueError when `amount` is not a whole number of cents between 0 and MAX_MONEY_AMOUNT. */
  static of(amount: number, currency: Currency): Money {
    if (!Number.isInteger(amount) || amount < 0 || amount > MAX_MONEY_AMOUNT) {
      throw new InvalidValueError(
        `Money amount must be a whole number of cents between 0 and ${MAX_MONEY_AMOUNT}`,
      );
    }
    return new Money(amount, currency);
  }

  static zero(currency: Currency): Money {
    return new Money(0, currency);
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.of(this.amount + other.amount, this.currency);
  }

  /** @throws InvalidValueError when the result would be negative. */
  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.of(this.amount - other.amount, this.currency);
  }

  /** The total of a line: this unit amount times a whole, non-negative quantity. */
  multiply(quantity: number): Money {
    if (!Number.isInteger(quantity) || quantity < 0) {
      throw new InvalidValueError(
        'Quantity must be a whole number, zero or more',
      );
    }
    return Money.of(this.amount * quantity, this.currency);
  }

  /**
   * The tax contained in this amount, which already includes it (ADR-0008, ADR-0079):
   * `amount × rate / (10000 + rate)`, rounded to the cent with halves rounded up (ADR-0094).
   * Call it once per line, since tax is rounded by line.
   *
   * @param rateBasisPoints tax rate in basis points, such as 1600 for 16%.
   */
  containedTax(rateBasisPoints: number): Money {
    if (
      !Number.isInteger(rateBasisPoints) ||
      rateBasisPoints < 0 ||
      rateBasisPoints > MAX_TAX_RATE_BASIS_POINTS
    ) {
      throw new InvalidValueError(
        `Tax rate must be a whole number of basis points between 0 and ${MAX_TAX_RATE_BASIS_POINTS}`,
      );
    }
    // BigInt keeps the division exact, so rounding never depends on floating point error.
    const numerator = BigInt(this.amount) * BigInt(rateBasisPoints);
    const denominator = BigInt(MAX_TAX_RATE_BASIS_POINTS + rateBasisPoints);
    const quotient = numerator / denominator;
    const remainder = numerator % denominator;
    const rounded = 2n * remainder >= denominator ? quotient + 1n : quotient;
    return new Money(Number(rounded), this.currency);
  }

  isZero(): boolean {
    return this.amount === 0;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.amount === other.amount;
  }

  /** Negative when this amount is smaller than `other`, zero when equal, positive when larger. */
  compareTo(other: Money): number {
    this.assertSameCurrency(other);
    return this.amount - other.amount;
  }

  greaterThan(other: Money): boolean {
    return this.compareTo(other) > 0;
  }

  greaterThanOrEqual(other: Money): boolean {
    return this.compareTo(other) >= 0;
  }

  lessThan(other: Money): boolean {
    return this.compareTo(other) < 0;
  }

  lessThanOrEqual(other: Money): boolean {
    return this.compareTo(other) <= 0;
  }

  /** The API representation (`API_SPEC.md` §8.1). */
  toJSON(): { amount: number; currency: Currency } {
    return { amount: this.amount, currency: this.currency };
  }

  /** Mixing currencies is a programming error, not a business rule, so it is not a DomainError. */
  private assertSameCurrency(other: Money): void {
    if (other.currency !== this.currency) {
      throw new Error(
        `Cannot combine money in ${this.currency} with money in ${other.currency}`,
      );
    }
  }
}
