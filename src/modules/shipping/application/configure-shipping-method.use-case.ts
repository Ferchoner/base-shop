import { Injectable } from '@nestjs/common';
import {
  assertVersion,
  AuditTrail,
  changesBetween,
  Money,
  NotFoundError,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import type { ShippingMethod } from '../domain/shipping-method.js';
import { ShippingMethodRepository } from '../domain/shipping-method.repository.js';

/** What the audit trail keeps of the method: every setting, amounts in cents. */
function auditedFields(method: ShippingMethod): Record<string, unknown> {
  const state = method.snapshot();
  return {
    name: state.name,
    flatFee: state.flatFee.amount,
    freeShippingThreshold: state.freeShippingThreshold?.amount ?? null,
    deliveryMinBusinessDays: state.deliveryMinBusinessDays,
    deliveryMaxBusinessDays: state.deliveryMaxBusinessDays,
  };
}

/**
 * Configures the flat fee, the free shipping threshold and the estimated delivery time (UC-SHI-02, ADR-0042,
 * ADR-0075, ADR-0083). Placed orders keep what they applied. Without changes, nothing is saved or audited.
 */
@Injectable()
export class ConfigureShippingMethod {
  constructor(
    private readonly methods: ShippingMethodRepository,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
  ) {}

  execute(input: {
    name: string;
    /** Cents, VAT included. */
    flatFee: number;
    /** Cents; `null` for no free shipping. */
    freeShippingThreshold: number | null;
    deliveryMinBusinessDays: number;
    deliveryMaxBusinessDays: number;
    version: number;
  }): Promise<void> {
    return this.transactions.run(async () => {
      const method = await this.methods.findActive();
      if (method === null) {
        throw new NotFoundError('ShippingMethod', 'active');
      }
      assertVersion(method.version, input.version);
      const before = auditedFields(method);
      method.configure({
        name: input.name,
        flatFee: Money.of(input.flatFee, 'MXN'),
        freeShippingThreshold:
          input.freeShippingThreshold === null
            ? null
            : Money.of(input.freeShippingThreshold, 'MXN'),
        deliveryMinBusinessDays: input.deliveryMinBusinessDays,
        deliveryMaxBusinessDays: input.deliveryMaxBusinessDays,
      });
      const changes = changesBetween(before, auditedFields(method));
      if (Object.keys(changes).length === 0) return;
      await this.methods.save(method);
      await this.audit.record({
        action: 'shipping-method.update',
        resource: { type: 'shipping-method', id: method.id },
        changes,
      });
    });
  }
}
