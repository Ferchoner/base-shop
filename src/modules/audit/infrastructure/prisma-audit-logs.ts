import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { Prisma } from '../../../platform/persistence/prisma/generated/client.js';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import type { AuditChanges } from '../../../shared-kernel/index.js';
import {
  ArchivableAuditLogs,
  startOf,
  type UtcDay,
} from '../application/audit-archive.js';
import {
  type AuditEntryView,
  type AuditFilter,
  type AuditPosition,
  AuditQueries,
} from '../application/audit-entries.js';

type AuditLogRow = Prisma.AuditLogGetPayload<object>;

const DAY_MS = 86_400_000;

/**
 * `audit_logs` (DATABASE.md §11.1), read by the staff newest first with the index `(occurred_at, id)` (UC-AUD-02,
 * ADR-0146).
 */
@Injectable()
export class PrismaAuditQueries extends AuditQueries {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  async list(
    filter: AuditFilter,
    position: AuditPosition | null,
    limit: number,
  ): Promise<AuditEntryView[]> {
    const rows = await this.txHost.tx.auditLog.findMany({
      where: {
        AND: [
          filter.actorId === undefined ? {} : { actorId: filter.actorId },
          filter.actorTypes === undefined
            ? {}
            : { actorType: { in: [...filter.actorTypes] } },
          filter.action === undefined ? {} : { action: filter.action },
          filter.actionPrefix === undefined
            ? {}
            : { action: { startsWith: filter.actionPrefix } },
          filter.resourceType === undefined
            ? {}
            : { resourceType: filter.resourceType },
          filter.resourceId === undefined
            ? {}
            : { resourceId: filter.resourceId },
          filter.results === undefined
            ? {}
            : { result: { in: [...filter.results] } },
          filter.from === undefined && filter.to === undefined
            ? {}
            : { occurredAt: { gte: filter.from, lte: filter.to } },
          position === null
            ? {}
            : {
                OR: [
                  { occurredAt: { lt: position.occurredAt } },
                  { occurredAt: position.occurredAt, id: { lt: position.id } },
                ],
              },
        ],
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    return rows.map(toAuditEntryView);
  }
}

/**
 * The records of `audit_logs` that leave the database, by UTC day (UC-AUD-03, ADR-0146). They are read oldest first
 * with the index `(occurred_at, id)`, and deleted in one statement in the transaction of the caller; the trigger of
 * the table rejects updates, never deletes.
 */
@Injectable()
export class PrismaArchivableAuditLogs extends ArchivableAuditLogs {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  async daysBefore(cutoff: Date, limit: number): Promise<UtcDay[]> {
    const rows = await this.txHost.tx.$queryRaw<{ day: string }[]>`
      SELECT to_char(day, 'YYYY-MM-DD') AS day
        FROM (SELECT DISTINCT (occurred_at AT TIME ZONE 'UTC')::date AS day
                FROM audit_logs
               WHERE occurred_at < ${cutoff}) AS days
       ORDER BY day
       LIMIT ${limit}`;
    return rows.map(({ day }) => day);
  }

  async entriesOf(
    day: UtcDay,
    position: AuditPosition | null,
    limit: number,
  ): Promise<AuditEntryView[]> {
    const start = startOf(day);
    const rows = await this.txHost.tx.auditLog.findMany({
      where: {
        occurredAt: { gte: start, lt: new Date(start.getTime() + DAY_MS) },
        ...(position === null
          ? {}
          : {
              OR: [
                { occurredAt: { gt: position.occurredAt } },
                { occurredAt: position.occurredAt, id: { gt: position.id } },
              ],
            }),
      },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    return rows.map(toAuditEntryView);
  }

  async deleteDay(day: UtcDay): Promise<string[]> {
    const start = startOf(day);
    const rows = await this.txHost.tx.$queryRaw<{ id: string }[]>`
      DELETE FROM audit_logs
       WHERE occurred_at >= ${start} AND occurred_at < ${new Date(start.getTime() + DAY_MS)}
      RETURNING id`;
    return rows.map(({ id }) => id);
  }
}

function toAuditEntryView(row: AuditLogRow): AuditEntryView {
  return {
    id: row.id,
    occurredAt: row.occurredAt,
    actorType: row.actorType,
    actorId: row.actorId,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    result: row.result,
    correlationId: row.correlationId,
    ip: row.ip,
    userAgent: row.userAgent,
    // Written by PrismaAuditTrail from AuditChanges.
    changes: row.changes as AuditChanges | null,
    reason: row.reason,
  };
}
