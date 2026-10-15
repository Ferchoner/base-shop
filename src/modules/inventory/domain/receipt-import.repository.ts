import { DomainError, type Id } from '../../../shared-kernel/index.js';

export type ReceiptImportId = Id<'ReceiptImport'>;

/** A file of receipts already imported, by the SHA-256 of its bytes (ADR-0164). */
export interface ReceiptImportRecord {
  readonly id: ReceiptImportId;
  /** In lowercase hexadecimal. */
  readonly fileSha256: string;
  readonly rows: number;
  readonly units: number;
  readonly createdBy: string;
  readonly createdAt: Date;
}

/**
 * The same file of receipts was already imported (ADR-0164): importing it again would add its units twice.
 * Answered 409 `duplicate-value` on `file`, with when it was imported.
 */
export class DuplicateReceiptFileError extends DomainError {
  readonly code = 'duplicate-value';
  readonly category = 'conflict';

  constructor(importedAt: Date | null) {
    super('The file of receipts was already imported', {
      field: 'file',
      ...(importedAt === null ? {} : { importedAt: importedAt.toISOString() }),
    });
  }
}

/**
 * `stock_receipt_imports` (ADR-0164), always through the active transaction. An abstract class rather than an
 * interface, so it can be the dependency injection token without depending on NestJS.
 */
export abstract class ReceiptImportRepository {
  /** When a file with this SHA-256 was imported, or `null`. */
  abstract importedAt(fileSha256: string): Promise<Date | null>;

  /**
   * Records an imported file. While another transaction records the same file, it waits for it.
   *
   * @throws DuplicateReceiptFileError, without when, if the file was already recorded.
   */
  abstract insert(record: ReceiptImportRecord): Promise<void>;
}
