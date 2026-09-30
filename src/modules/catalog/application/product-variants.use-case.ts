import { Injectable } from '@nestjs/common';
import {
  assertVersion,
  AuditTrail,
  changesBetween,
  Clock,
  DomainEventPublisher,
  newId,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import type { Product, VariantChanges } from '../domain/product.js';
import type { ProductId } from '../domain/product-id.js';
import { ProductRepository } from '../domain/product.repository.js';
import type { VariantDimensions, VariantId } from '../domain/variant.js';
import {
  auditedVariantFields,
  findProduct,
  variantOf,
} from './product-support.js';

type VariantAction = 'create' | 'update' | 'discontinue' | 'reactivate';

/**
 * Variants of a product (UC-CAT-06 to 08): each change carries the product `version`, since the variants are
 * part of its aggregate. Discontinuing publishes `VariantDiscontinued` after the commit, which clears the
 * public catalog cache (ADR-0104). Each change is audited on the variant.
 */
@Injectable()
export class ProductVariants {
  constructor(
    private readonly products: ProductRepository,
    private readonly transactions: TransactionManager,
    private readonly events: DomainEventPublisher,
    private readonly clock: Clock,
    private readonly audit: AuditTrail,
  ) {}

  /** Adds an active variant and returns its ID. */
  async add(
    productId: ProductId,
    input: VariantDimensions & {
      sku: string;
      options: Readonly<Record<string, unknown>>;
      version: number;
    },
  ): Promise<VariantId> {
    const variantId = newId<'Variant'>();
    await this.change(
      productId,
      input.version,
      variantId,
      'create',
      (product) => product.addVariant({ ...input, id: variantId }),
    );
    return variantId;
  }

  update(
    productId: ProductId,
    variantId: VariantId,
    changes: VariantChanges & { version: number },
  ): Promise<void> {
    return this.change(
      productId,
      changes.version,
      variantId,
      'update',
      (product) => product.updateVariant(variantId, changes),
    );
  }

  discontinue(
    productId: ProductId,
    variantId: VariantId,
    version: number,
  ): Promise<void> {
    return this.change(
      productId,
      version,
      variantId,
      'discontinue',
      (product) => product.discontinueVariant(variantId, this.clock.now()),
    );
  }

  reactivate(
    productId: ProductId,
    variantId: VariantId,
    version: number,
  ): Promise<void> {
    return this.change(productId, version, variantId, 'reactivate', (product) =>
      product.reactivateVariant(variantId),
    );
  }

  /** Without changes, as when an edit repeats the current values, nothing is saved or audited. */
  private change(
    productId: ProductId,
    version: number,
    variantId: VariantId,
    action: VariantAction,
    apply: (product: Product) => void,
  ): Promise<void> {
    return this.transactions.run(async () => {
      const product = await findProduct(this.products, productId);
      assertVersion(product.version, version);
      const before = auditedVariantFields(variantOf(product, variantId));
      apply(product);
      const changes = changesBetween(
        before,
        auditedVariantFields(variantOf(product, variantId)),
      );
      if (Object.keys(changes).length === 0) return;
      await this.products.save(product);
      this.events.publish(...product.pullEvents());
      await this.audit.record({
        action: `products.variant-${action}`,
        resource: { type: 'variant', id: variantId },
        changes,
      });
    });
  }
}
