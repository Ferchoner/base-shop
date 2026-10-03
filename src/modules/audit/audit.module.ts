import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../platform/config/environment.js';
import { AuditTrail } from '../../shared-kernel/index.js';
import {
  ArchivableAuditLogs,
  AUDIT_RETENTION,
  AuditArchive,
  AuditArchiveFiles,
  type AuditRetention,
} from './application/audit-archive.js';
import { AuditListing, AuditQueries } from './application/audit-entries.js';
import { AuditArchiveJob } from './infrastructure/audit-archive.job.js';
import {
  AUDIT_ARCHIVE_SETTINGS,
  type AuditArchiveSettings,
  LocalDiskAuditArchiveFiles,
} from './infrastructure/local-disk-audit-archive-files.js';
import {
  PrismaArchivableAuditLogs,
  PrismaAuditQueries,
} from './infrastructure/prisma-audit-logs.js';
import { PrismaAuditTrail } from './infrastructure/prisma-audit-trail.js';
import { AdminAuditController } from './presentation/admin-audit.controller.js';

/**
 * Technical audit (ADR-0037, ADR-0100, ADR-0146): a cross-cutting capability, not a bounded context (ADR-0088).
 * Global, so every context records through the AuditTrail port. The staff reads it with `audit.read`, and a daily
 * job moves the records older than their retention to archive files.
 */
@Global()
@Module({
  controllers: [AdminAuditController],
  providers: [
    { provide: AuditTrail, useClass: PrismaAuditTrail },
    AuditListing,
    { provide: AuditQueries, useClass: PrismaAuditQueries },
    AuditArchive,
    AuditArchiveJob,
    { provide: ArchivableAuditLogs, useClass: PrismaArchivableAuditLogs },
    { provide: AuditArchiveFiles, useClass: LocalDiskAuditArchiveFiles },
    {
      provide: AUDIT_RETENTION,
      inject: [ConfigService],
      useFactory: (
        config: ConfigService<EnvironmentVariables, true>,
      ): AuditRetention => ({
        databaseMonths: config.get('AUDIT_RETENTION_MONTHS', { infer: true }),
        archiveMonths: config.get('AUDIT_ARCHIVE_RETENTION_MONTHS', {
          infer: true,
        }),
      }),
    },
    {
      provide: AUDIT_ARCHIVE_SETTINGS,
      inject: [ConfigService],
      useFactory: (
        config: ConfigService<EnvironmentVariables, true>,
      ): AuditArchiveSettings => ({
        directory: config.get('AUDIT_ARCHIVE_DIR', { infer: true }),
      }),
    },
  ],
  exports: [AuditTrail],
})
export class AuditModule {}
