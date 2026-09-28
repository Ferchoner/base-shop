import type { AuditChanges } from './audit-changes.js';

/** Who acted. By default, the authenticated user of the request, or SYSTEM outside a request. */
export type AuditActor =
  | { readonly type: 'USER'; readonly id: string }
  | { readonly type: 'SYSTEM' }
  | { readonly type: 'ANONYMOUS' };

export type AuditResult = 'SUCCESS' | 'DENIED' | 'FAILED';

export interface AuditEntry {
  /** Stable code `<area>.<action>`, such as `orders.cancel` (ADR-0037). */
  readonly action: string;
  readonly resource?: { readonly type: string; readonly id: string };
  /** Defaults to SUCCESS. */
  readonly result?: AuditResult;
  /** Build it with `changesBetween`, which hides personal and sensitive values. */
  readonly changes?: AuditChanges;
  /** Only when the request does not say who acted, for example ANONYMOUS on a failed login. */
  readonly actor?: AuditActor;
  /**
   * Why a staff member acted, in their own words, when the action asks for it (suspend, reactivate…): 1 to
   * 500 characters (ADR-0112). It is free text, so the API never asks for personal data in it.
   */
  readonly reason?: string;
}

/**
 * Technical audit trail (ADR-0037, ADR-0100): every staff change and every security event. The IP, user
 * agent and correlation id come from the current request.
 *
 * An abstract class rather than an interface, so it can be the dependency injection token without depending
 * on NestJS.
 */
export abstract class AuditTrail {
  /** Records the entry in the active transaction, so it commits or rolls back with the change. */
  abstract record(entry: AuditEntry): Promise<void>;

  /**
   * Records the entry on its own, even inside a transaction that will roll back: for denied attempts and
   * failed logins (ADR-0037).
   */
  abstract recordIndependently(entry: AuditEntry): Promise<void>;
}
