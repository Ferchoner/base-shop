import { Global, Module } from '@nestjs/common';
import { ClsModule } from 'nestjs-cls';
import { TransactionManager } from '../../shared-kernel/transaction-manager.js';
import { ClsTransactionManager } from './cls-transaction-manager.js';
import { PrismaModule } from './prisma.module.js';
import { createTransactionalPlugin } from './transactional-plugin.js';

/**
 * Database access shared by every context (ADR-0091, ADR-0093): PrismaService and TransactionHost for the
 * infrastructure layer, TransactionManager for the application layer. Needs `ClsModule.forRoot` in the root
 * module.
 */
@Global()
@Module({
  imports: [
    PrismaModule,
    ClsModule.registerPlugins([createTransactionalPlugin()]),
  ],
  providers: [{ provide: TransactionManager, useClass: ClsTransactionManager }],
  exports: [PrismaModule, TransactionManager],
})
export class PersistenceModule {}
