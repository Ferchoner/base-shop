import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionManager } from '../../shared-kernel/transaction-manager.js';
import {
  currentTransactionScope,
  withTransactionScope,
} from './transaction-scope.js';
import type { PrismaTransactionAdapter } from './transactional-plugin.js';

/** TransactionManager backed by nestjs-cls and Prisma interactive transactions (ADR-0093, ADR-0098). */
@Injectable()
export class ClsTransactionManager extends TransactionManager {
  /** Numbers the savepoints, whose names only need to be unique within a transaction. */
  private savepoints = 0;

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

  /**
   * A savepoint inside the active transaction: rolling back to it undoes the writes of `work` and leaves the
   * transaction usable, even after a failed statement. The events `work` published are dropped with them.
   */
  async runNested<T>(work: () => Promise<T>): Promise<T> {
    if (!this.txHost.isTransactionActive()) return this.run(work);
    const savepoint = `nested_${(this.savepoints += 1)}`;
    const scope = currentTransactionScope();
    const mark = scope?.mark() ?? 0;
    // The name is generated here, never received, so it can be part of the statement.
    await this.txHost.tx.$executeRawUnsafe(`SAVEPOINT ${savepoint}`);
    try {
      const result = await work();
      await this.txHost.tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      await this.txHost.tx.$executeRawUnsafe(
        `ROLLBACK TO SAVEPOINT ${savepoint}`,
      );
      scope?.discardSince(mark);
      throw error;
    }
  }
}
