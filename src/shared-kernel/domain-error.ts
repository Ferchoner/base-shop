/**
 * What kind of rule a domain error breaks. The presentation layer maps each category to an HTTP status
 * (400, 403, 404 and 409, ADR-0064); the domain never knows HTTP (ADR-0035).
 */
export type DomainErrorCategory =
  'invalid' | 'forbidden' | 'not-found' | 'conflict';

/**
 * Base class for business rule violations (ADR-0003, ADR-0094). Each subclass sets:
 * - `code`: the stable problem type of `API_SPEC.md` §6.2, such as `insufficient-stock`.
 * - `category`: how the presentation layer answers it.
 *
 * `details` become Problem Details extensions (such as `lines` or `currentVersion`), so they must never hold
 * sensitive or personal data.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly category: DomainErrorCategory;

  constructor(
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** A value that breaks the rules of a value object, such as a negative amount or a malformed ID. */
export class InvalidValueError extends DomainError {
  readonly code = 'validation-error';
  readonly category = 'invalid';
}
