import { ClsPluginTransactional } from '@nestjs-cls/transactional';
import { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import { Prisma } from './prisma/generated/client.js';
import { PrismaModule } from './prisma.module.js';
import { PrismaService } from './prisma.service.js';

/**
 * Repositories reach the database through `TransactionHost<PrismaTransactionAdapter>` (ADR-0093): `txHost.tx`
 * is the client of the active transaction, or the regular PrismaService when no transaction is active. Inject
 * `TransactionHost` itself; a type alias of it would lose the class that NestJS needs to resolve the dependency.
 */
export type PrismaTransactionAdapter =
  TransactionalAdapterPrisma<PrismaService>;

/**
 * Read Committed, stated explicitly (ARCHITECTURE.md). Prisma's default time limits: wait at most 2 s to
 * start and roll back any transaction still running after 5 s.
 */
const TRANSACTION_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  maxWait: 2_000,
  timeout: 5_000,
};

/**
 * nestjs-cls plugin that keeps the active Prisma transaction in the async context (ADR-0033). Without
 * `sqlFlavor` there are no savepoints: a nested transaction joins the outer one.
 */
export function createTransactionalPlugin(): ClsPluginTransactional {
  return new ClsPluginTransactional({
    imports: [PrismaModule],
    adapter: new TransactionalAdapterPrisma<PrismaService>({
      prismaInjectionToken: PrismaService,
      defaultTxOptions: TRANSACTION_OPTIONS,
    }),
  });
}
