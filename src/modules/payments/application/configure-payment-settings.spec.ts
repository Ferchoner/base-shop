import {
  type AuditEntry,
  type AuditTrail,
  toId,
  type TransactionManager,
  VersionConflictError,
} from '../../../shared-kernel/index.js';
import { PaymentSettings } from '../domain/payment-settings.js';
import { PaymentSettingsRepository } from '../domain/payment-settings.repository.js';
import { ConfigurePaymentSettings } from './configure-payment-settings.use-case.js';

const ID = toId<'PaymentSettings'>('01a11302-41ef-7d33-9e36-93a5239b19ba');

class InMemorySettings extends PaymentSettingsRepository {
  readonly saved: PaymentSettings[] = [];

  constructor(private stored: { enabled: boolean; version: number }) {
    super();
  }

  find(): Promise<PaymentSettings> {
    return Promise.resolve(
      PaymentSettings.restore({
        id: ID,
        manualPaymentsEnabled: this.stored.enabled,
        version: this.stored.version,
      }),
    );
  }

  save(settings: PaymentSettings): Promise<void> {
    this.saved.push(settings);
    this.stored = {
      enabled: settings.manualPaymentsEnabled,
      version: settings.version + 1,
    };
    settings.markSaved(settings.version + 1);
    return Promise.resolve();
  }
}

function setUp(stored = { enabled: false, version: 3 }) {
  const settings = new InMemorySettings(stored);
  const audited: AuditEntry[] = [];
  const audit = {
    record: (entry: AuditEntry) => {
      audited.push(entry);
      return Promise.resolve();
    },
  } as unknown as AuditTrail;
  const inline = {
    run: <T>(work: () => Promise<T>) => work(),
  } as unknown as TransactionManager;
  return {
    configure: new ConfigurePaymentSettings(settings, inline, audit),
    settings,
    audited,
  };
}

describe('ConfigurePaymentSettings (UC-PAY-08, ADR-0162)', () => {
  it('turns manual payments on and off, saving each change at a new version and auditing what changed', async () => {
    const { configure, settings, audited } = setUp();

    await configure.execute({ manualPaymentsEnabled: true, version: 3 });
    await configure.execute({ manualPaymentsEnabled: false, version: 4 });

    expect(settings.saved.map((saved) => saved.snapshot())).toEqual([
      { id: ID, manualPaymentsEnabled: true, version: 4 },
      { id: ID, manualPaymentsEnabled: false, version: 5 },
    ]);
    expect(audited).toEqual([
      {
        action: 'payment-settings.update',
        resource: { type: 'payment-settings', id: ID },
        changes: { manualPaymentsEnabled: { from: false, to: true } },
      },
      {
        action: 'payment-settings.update',
        resource: { type: 'payment-settings', id: ID },
        changes: { manualPaymentsEnabled: { from: true, to: false } },
      },
    ]);
  });

  it('saves and audits nothing when the value does not change', async () => {
    const { configure, settings, audited } = setUp({
      enabled: true,
      version: 3,
    });

    await configure.execute({ manualPaymentsEnabled: true, version: 3 });

    expect([settings.saved, audited]).toEqual([[], []]);
  });

  it('rejects an older version before changing anything', async () => {
    const { configure, settings, audited } = setUp();

    await expect(
      configure.execute({ manualPaymentsEnabled: true, version: 2 }),
    ).rejects.toEqual(new VersionConflictError(3));
    expect([settings.saved, audited]).toEqual([[], []]);
  });
});
