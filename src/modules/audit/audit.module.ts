import { Global, Module } from '@nestjs/common';
import { AuditTrail } from '../../shared-kernel/index.js';
import { PrismaAuditTrail } from './infrastructure/prisma-audit-trail.js';

/**
 * Technical audit (ADR-0037, ADR-0100): a cross-cutting capability, not a bounded context (ADR-0088).
 * Global, so every context records through the AuditTrail port. Querying and archiving come with T-220.
 */
@Global()
@Module({
  providers: [{ provide: AuditTrail, useClass: PrismaAuditTrail }],
  exports: [AuditTrail],
})
export class AuditModule {}
