import { Injectable } from '@nestjs/common';
import {
  assertVersion,
  AuditTrail,
  changesBetween,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import { PaymentSettingsRepository } from '../domain/payment-settings.repository.js';

/**
 * Turns manual payments on or off (UC-PAY-08, ADR-0162), with the permission that only the superadmin role holds.
 * It counts from the next operation: a payment that already passed the check finishes. Without changes, nothing is
 * saved or audited.
 */
@Injectable()
export class ConfigurePaymentSettings {
  constructor(
    private readonly settings: PaymentSettingsRepository,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
  ) {}

  execute(input: {
    manualPaymentsEnabled: boolean;
    version: number;
  }): Promise<void> {
    return this.transactions.run(async () => {
      const settings = await this.settings.find();
      assertVersion(settings.version, input.version);
      const before = settings.manualPaymentsEnabled;
      settings.setManualPayments(input.manualPaymentsEnabled);
      const changes = changesBetween(
        { manualPaymentsEnabled: before },
        { manualPaymentsEnabled: settings.manualPaymentsEnabled },
      );
      if (Object.keys(changes).length === 0) return;
      await this.settings.save(settings);
      await this.audit.record({
        action: 'payment-settings.update',
        resource: { type: 'payment-settings', id: settings.id },
        changes,
      });
    });
  }
}
