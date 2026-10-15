import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { uniqueViolationIndex } from '../../../platform/persistence/prisma-errors.js';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import {
  DuplicateReceiptFileError,
  type ReceiptImportRecord,
  ReceiptImportRepository,
} from '../domain/receipt-import.repository.js';

/** `stock_receipt_imports` (DATABASE.md §6.6), always through the active transaction. */
@Injectable()
export class PrismaReceiptImportRepository extends ReceiptImportRepository {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  async importedAt(fileSha256: string): Promise<Date | null> {
    const row = await this.txHost.tx.stockReceiptImport.findUnique({
      select: { createdAt: true },
      where: { fileSha256 },
    });
    return row?.createdAt ?? null;
  }

  async insert(record: ReceiptImportRecord): Promise<void> {
    try {
      await this.txHost.tx.stockReceiptImport.create({ data: { ...record } });
    } catch (error) {
      if (
        uniqueViolationIndex(error) === 'stock_receipt_imports_file_sha256_key'
      ) {
        throw new DuplicateReceiptFileError(null);
      }
      throw error;
    }
  }
}
