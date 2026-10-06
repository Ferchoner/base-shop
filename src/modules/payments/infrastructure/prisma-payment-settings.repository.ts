import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import { toId, VersionConflictError } from '../../../shared-kernel/index.js';
import { PaymentSettings } from '../domain/payment-settings.js';
import { PaymentSettingsRepository } from '../domain/payment-settings.repository.js';

/** `payment_settings` (DATABASE.md §9), always through the active transaction. */
@Injectable()
export class PrismaPaymentSettingsRepository extends PaymentSettingsRepository {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  async find(): Promise<PaymentSettings> {
    const row = await this.txHost.tx.paymentSettings.findFirst();
    // Its migration creates the only row, and nothing deletes it (ADR-0162).
    if (row === null) throw new Error('payment_settings has no row');
    return PaymentSettings.restore({
      id: toId<'PaymentSettings'>(row.id),
      manualPaymentsEnabled: row.manualPaymentsEnabled,
      version: row.version,
    });
  }

  async save(settings: PaymentSettings): Promise<void> {
    const state = settings.snapshot();
    const tx = this.txHost.tx;
    const { count } = await tx.paymentSettings.updateMany({
      where: { id: state.id, version: state.version },
      data: {
        manualPaymentsEnabled: state.manualPaymentsEnabled,
        version: { increment: 1 },
      },
    });
    if (count === 0) {
      const current = await tx.paymentSettings.findUniqueOrThrow({
        where: { id: state.id },
        select: { version: true },
      });
      throw new VersionConflictError(current.version);
    }
    settings.markSaved(state.version + 1);
  }
}
