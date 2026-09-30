import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import {
  Money,
  toId,
  VersionConflictError,
} from '../../../shared-kernel/index.js';
import { ShippingMethod } from '../domain/shipping-method.js';
import { ShippingMethodRepository } from '../domain/shipping-method.repository.js';

/** `shipping_methods` (DATABASE.md §10.1), always through the active transaction. */
@Injectable()
export class PrismaShippingMethodRepository extends ShippingMethodRepository {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  async findActive(): Promise<ShippingMethod | null> {
    const row = await this.txHost.tx.shippingMethod.findFirst({
      where: { isActive: true },
    });
    return row === null
      ? null
      : ShippingMethod.restore({
          id: toId<'ShippingMethod'>(row.id),
          name: row.name,
          flatFee: Money.of(row.flatFee, 'MXN'),
          freeShippingThreshold:
            row.freeShippingThreshold === null
              ? null
              : Money.of(row.freeShippingThreshold, 'MXN'),
          deliveryMinBusinessDays: row.deliveryMinBusinessDays,
          deliveryMaxBusinessDays: row.deliveryMaxBusinessDays,
          isActive: row.isActive,
          version: row.version,
        });
  }

  async save(method: ShippingMethod): Promise<void> {
    const state = method.snapshot();
    const tx = this.txHost.tx;
    const { count } = await tx.shippingMethod.updateMany({
      where: { id: state.id, version: state.version },
      data: {
        name: state.name,
        flatFee: state.flatFee.amount,
        freeShippingThreshold: state.freeShippingThreshold?.amount ?? null,
        deliveryMinBusinessDays: state.deliveryMinBusinessDays,
        deliveryMaxBusinessDays: state.deliveryMaxBusinessDays,
        version: { increment: 1 },
      },
    });
    if (count === 0) {
      const current = await tx.shippingMethod.findUniqueOrThrow({
        where: { id: state.id },
        select: { version: true },
      });
      throw new VersionConflictError(current.version);
    }
    method.markSaved(state.version + 1);
  }
}
