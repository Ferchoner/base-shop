import type { ProblemCode } from './problem-types.js';

/**
 * An HTTP error that does not come from the domain (ADR-0095): authentication, idempotency, rate limiting or
 * input validation. Presentation and infrastructure code throw it; the status comes from the catalog.
 */
export class ProblemException extends Error {
  constructor(
    readonly code: ProblemCode,
    /** Problem Details extensions, such as `errors`. Never sensitive or personal data. */
    readonly extensions: Readonly<Record<string, unknown>> = {},
    /** Extra response headers, such as `Retry-After`. */
    readonly headers: Readonly<Record<string, string>> = {},
  ) {
    super(code);
    this.name = 'ProblemException';
  }
}
