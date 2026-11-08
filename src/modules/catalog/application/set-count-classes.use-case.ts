import { Injectable } from '@nestjs/common';
import {
  AuditTrail,
  changesBetween,
  NotFoundError,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import type { CountClass } from '../domain/product.js';
import { DuplicateProductError } from '../domain/product-errors.js';
import type { ProductId } from '../domain/product-id.js';
import { ProductRepository } from '../domain/product.repository.js';

/** Most products one request classifies (ADR-0173). */
export const MAX_COUNT_CLASS_ITEMS = 500;

/** The count class of a product; `null` clears it. */
export interface CountClassChange {
  readonly productId: ProductId;
  readonly countClass: CountClass | null;
}

/**
 * The count class of several products at once (ADR-0173), as the staff applies the class Ordering suggests from the
 * sales of the last 90 days. All or nothing: a missing product changes none. A product in any status, archived too,
 * since it can still have units to count. Without `version`: the class is the only field it changes, and the
 * version of each product it changes goes up. Each product that changes is audited as `products.update`.
 */
@Injectable()
export class SetCountClasses {
  constructor(
    private readonly products: ProductRepository,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
  ) {}

  /**
   * @throws DuplicateProductError when a product comes twice.
   * @throws NotFoundError when a product does not exist.
   */
  execute(changes: readonly CountClassChange[]): Promise<{ updated: number }> {
    const ids = changes.map(({ productId }) => productId);
    if (new Set(ids).size !== ids.length) throw new DuplicateProductError();
    return this.transactions.run(async () => {
      let updated = 0;
      for (const { productId, countClass } of changes) {
        const product = await this.products.findById(productId);
        if (product === null) throw new NotFoundError('Product', productId);
        const before = product.snapshot().countClass;
        if (before === countClass) continue;
        product.changeCountClass(countClass);
        await this.products.save(product);
        await this.audit.record({
          action: 'products.update',
          resource: { type: 'product', id: productId },
          changes: changesBetween({ countClass: before }, { countClass }),
        });
        updated += 1;
      }
      return { updated };
    });
  }
}
