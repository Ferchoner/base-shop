import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionManager } from '../../shared-kernel/transaction-manager.js';
import type { PrismaTransactionAdapter } from './transactional-plugin.js';

/** TransactionManager backed by nestjs-cls and Prisma interactive transactions (ADR-0093). */
@Injectable()
export class ClsTransactionManager extends TransactionManager {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  run<T>(work: () => Promise<T>): Promise<T> {
    return this.txHost.withTransaction(work);
  }
}
