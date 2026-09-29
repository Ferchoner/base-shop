import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionManager } from '../../shared-kernel/transaction-manager.js';
import { withTransactionScope } from './transaction-scope.js';
import type { PrismaTransactionAdapter } from './transactional-plugin.js';

/** TransactionManager backed by nestjs-cls and Prisma interactive transactions (ADR-0093, ADR-0098). */
@Injectable()
export class ClsTransactionManager extends TransactionManager {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    // A nested run joins the outer transaction, whose scope collects the after-commit work. It runs the work
    // as is: asking nestjs-cls for a transaction again would log a warning that its options are ignored.
    if (this.txHost.isTransactionActive()) {
      return work();
    }
    return withTransactionScope(async (scope) => {
      const result = await this.txHost.withTransaction(work);
      scope.runAfterCommitCallbacks();
      return result;
    });
  }
}
