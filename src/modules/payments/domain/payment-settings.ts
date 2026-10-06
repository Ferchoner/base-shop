import type { Id } from '../../../shared-kernel/index.js';

export type PaymentSettingsId = Id<'PaymentSettings'>;

export interface PaymentSettingsSnapshot {
  readonly id: PaymentSettingsId;
  /** Whether the store takes manual payments and refunds, and customers may choose to pay in the store. */
  readonly manualPaymentsEnabled: boolean;
  readonly version: number;
}

/**
 * The settings of Payments (DATABASE.md §9, ADR-0162): one row, created by a migration with manual payments off,
 * which a superadmin changes with optimistic locking. Until version 1.3, `MANUAL_PAYMENTS_ENABLED` decided it.
 */
export class PaymentSettings {
  private constructor(private state: PaymentSettingsSnapshot) {}

  static restore(snapshot: PaymentSettingsSnapshot): PaymentSettings {
    return new PaymentSettings(snapshot);
  }

  get id(): PaymentSettingsId {
    return this.state.id;
  }

  get manualPaymentsEnabled(): boolean {
    return this.state.manualPaymentsEnabled;
  }

  get version(): number {
    return this.state.version;
  }

  /** Turns manual payments on or off (UC-PAY-08). */
  setManualPayments(enabled: boolean): void {
    this.state = { ...this.state, manualPaymentsEnabled: enabled };
  }

  /** Called by the repository once a change is saved. */
  markSaved(version: number): void {
    this.state = { ...this.state, version };
  }

  snapshot(): PaymentSettingsSnapshot {
    return this.state;
  }
}
