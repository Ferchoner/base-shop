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

/**
 * The client sent an outdated `version` of a resource, or another change won the race (optimistic locking,
 * E-05): it must read the resource again and retry.
 */
export class VersionConflictError extends DomainError {
  readonly code = 'version-conflict';
  readonly category = 'conflict';

  constructor(currentVersion: number) {
    super(`The resource is at version ${currentVersion}`, { currentVersion });
  }
}

/** The action is not allowed in the current status of the resource (E-12), such as suspending it twice. */
export class InvalidStateTransitionError extends DomainError {
  readonly code = 'invalid-state-transition';
  readonly category = 'conflict';

  constructor(currentStatus: string, action: string) {
    super(`Cannot ${action} from status ${currentStatus}`, { currentStatus });
  }
}
