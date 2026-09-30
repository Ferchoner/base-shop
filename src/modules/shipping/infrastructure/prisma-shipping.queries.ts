import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import { Money, toId } from '../../../shared-kernel/index.js';
import {
  ShippingQueries,
  type ShippingMethodView,
} from '../application/shipping.queries.js';

/** Read models of Shipping, straight from `shipping_methods`. */
@Injectable()
export class PrismaShippingQueries extends ShippingQueries {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  async findActiveMethod(): Promise<ShippingMethodView | null> {
    const row = await this.txHost.tx.shippingMethod.findFirst({
      where: { isActive: true },
    });
    return row === null
      ? null
      : {
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
          updatedAt: row.updatedAt,
        };
  }
}
