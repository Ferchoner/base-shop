import { Injectable } from '@nestjs/common';
import type {
  AuditActor,
  AuditChanges,
  AuditResult,
} from '../../../shared-kernel/index.js';

export const ACTOR_TYPES: readonly AuditActor['type'][] = [
  'USER',
  'SYSTEM',
  'ANONYMOUS',
];

export const AUDIT_RESULTS: readonly AuditResult[] = [
  'SUCCESS',
  'DENIED',
  'FAILED',
];

/**
 * A record of the audit trail, as the staff reads it and as the archive keeps it (`AuditEntry`, API_SPEC.md §18,
 * ADR-0037). `changes` never holds sensitive or personal values (ADR-0067, ADR-0100).
 */
export interface AuditEntryView {
  readonly id: string;
  readonly occurredAt: Date;
  readonly actorType: AuditActor['type'];
  readonly actorId: string | null;
  readonly action: string;
  readonly resourceType: string | null;
  readonly resourceId: string | null;
  readonly result: AuditResult;
  readonly correlationId: string | null;
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly changes: AuditChanges | null;
  /** Why the staff acted, in their own words (ADR-0112). */
  readonly reason: string | null;
}

/** What a page of the audit trail is filtered by; every filter is optional. */
export interface AuditFilter {
  readonly actorId?: string;
  /** Any of these. */
  readonly actorTypes?: readonly AuditActor['type'][];
  /** An exact code, such as `orders.cancel`. */
  readonly action?: string;
  /** Every code that starts with it, such as `orders.`. */
  readonly actionPrefix?: string;
  readonly resourceType?: string;
  readonly resourceId?: string;
  /** Any of these. */
  readonly results?: readonly AuditResult[];
  /** At or after. */
  readonly from?: Date;
  /** At or before. */
  readonly to?: Date;
}

/** Where a page of the audit trail starts: after the record with this time and ID, newest first. */
export interface AuditPosition {
  readonly occurredAt: Date;
  readonly id: string;
}

/**
 * The audit trail kept in the database, the last months of it (ADR-0037). An abstract class rather than an
 * interface, so it can be the dependency injection token without depending on NestJS.
 */
export abstract class AuditQueries {
  /** Up to `limit` records after `position`, or from the newest, newest first; ties are broken by ID. */
  abstract list(
    filter: AuditFilter,
    position: AuditPosition | null,
    limit: number,
  ): Promise<AuditEntryView[]>;
}

/** The staff's reading of the audit trail (UC-AUD-02): paginated by cursor, newest first, and never audited. */
@Injectable()
export class AuditListing {
  constructor(private readonly queries: AuditQueries) {}

  /** A page of records, and where the next page starts, if any. */
  async page(
    filter: AuditFilter,
    position: AuditPosition | null,
    limit: number,
  ): Promise<{ entries: AuditEntryView[]; next: AuditPosition | null }> {
    const found = await this.queries.list(filter, position, limit + 1);
    const entries = found.slice(0, limit);
    const last = entries.at(-1);
    return {
      entries,
      next:
        found.length > limit && last !== undefined
          ? { occurredAt: last.occurredAt, id: last.id }
          : null,
    };
  }
}
