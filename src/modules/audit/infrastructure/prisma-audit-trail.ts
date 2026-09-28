import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { currentRequestContext } from '../../../platform/http/request-context.js';
import type { Prisma } from '../../../platform/persistence/prisma/generated/client.js';
import { PrismaService } from '../../../platform/persistence/prisma.service.js';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import {
  type AuditActor,
  type AuditEntry,
  AuditTrail,
  Clock,
  newId,
  redactAuditChanges,
} from '../../../shared-kernel/index.js';

/** `<area>.<action>` in lowercase with hyphens, such as `orders.cancel` or `http.access-denied`. */
const ACTION_CODE = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;

type AuditWriter = Pick<PrismaService, 'auditLog'>;

/** Writes the audit trail to `audit_logs` (ADR-0037, ADR-0100). The table rejects updates (trigger). */
@Injectable()
export class PrismaAuditTrail extends AuditTrail {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {
    super();
  }

  record(entry: AuditEntry): Promise<void> {
    return this.write(this.txHost.tx, entry);
  }

  recordIndependently(entry: AuditEntry): Promise<void> {
    // PrismaService never joins the active transaction.
    return this.write(this.prisma, entry);
  }

  private async write(writer: AuditWriter, entry: AuditEntry): Promise<void> {
    if (!ACTION_CODE.test(entry.action)) {
      throw new Error(
        `Audit action "${entry.action}" is not a stable code like "orders.cancel"`,
      );
    }
    const context = currentRequestContext();
    const actor = entry.actor ?? defaultActor(context);
    await writer.auditLog.create({
      data: {
        id: newId(),
        occurredAt: this.clock.now(),
        actorType: actor.type,
        actorId: actor.type === 'USER' ? actor.id : null,
        action: entry.action,
        resourceType: entry.resource?.type ?? null,
        resourceId: entry.resource?.id ?? null,
        result: entry.result ?? 'SUCCESS',
        correlationId: context.correlationId ?? null,
        ip: context.ip ?? null,
        userAgent: context.userAgent ?? null,
        changes: entry.changes
          ? (redactAuditChanges(entry.changes) as Prisma.InputJsonValue)
          : undefined,
      },
    });
  }
}

/** The authenticated user; nobody known inside a request; the system outside one (for example, a job). */
function defaultActor(
  context: ReturnType<typeof currentRequestContext>,
): AuditActor {
  if (context.userId) return { type: 'USER', id: context.userId };
  return context.correlationId ? { type: 'ANONYMOUS' } : { type: 'SYSTEM' };
}
