import { Injectable } from '@nestjs/common';
import {
  assertVersion,
  AuditTrail,
  changesBetween,
  Clock,
  DomainEventPublisher,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import type { Product } from '../domain/product.js';
import type { ProductId } from '../domain/product-id.js';
import { ProductRepository } from '../domain/product.repository.js';
import {
  auditedProductFields,
  findProduct,
  LONG_PRODUCT_FIELDS,
} from './product-support.js';

type Lifecycle = 'publish' | 'archive' | 'reactivate';

/**
 * Publishes, archives and reactivates products (UC-CAT-09 and 10, ADR-0076) with optimistic locking.
 * Publishing and archiving publish `ProductPublished` and `ProductArchived` after the commit, which clear the
 * public catalog cache (ADR-0104); reactivating publishes nothing, since the product comes back as a draft.
 */
@Injectable()
export class ProductLifecycle {
  constructor(
    private readonly products: ProductRepository,
    private readonly transactions: TransactionManager,
    private readonly events: DomainEventPublisher,
    private readonly clock: Clock,
    private readonly audit: AuditTrail,
  ) {}

  publish(id: ProductId, version: number): Promise<void> {
    return this.change(id, version, 'publish', (product) =>
      product.publish(this.clock.now()),
    );
  }

  archive(id: ProductId, version: number): Promise<void> {
    return this.change(id, version, 'archive', (product) =>
      product.archive(this.clock.now()),
    );
  }

  reactivate(id: ProductId, version: number): Promise<void> {
    return this.change(id, version, 'reactivate', (product) =>
      product.reactivate(),
    );
  }

  private change(
    id: ProductId,
    version: number,
    action: Lifecycle,
    apply: (product: Product) => void,
  ): Promise<void> {
    return this.transactions.run(async () => {
      const product = await findProduct(this.products, id);
      assertVersion(product.version, version);
      const before = auditedProductFields(product);
      apply(product);
      await this.products.save(product);
      this.events.publish(...product.pullEvents());
      await this.audit.record({
        action: `products.${action}`,
        resource: { type: 'product', id },
        changes: changesBetween(before, auditedProductFields(product), {
          personal: LONG_PRODUCT_FIELDS,
        }),
      });
    });
  }
}
