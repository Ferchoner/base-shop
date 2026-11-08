import { Injectable } from '@nestjs/common';
import { Clock } from '../../../shared-kernel/index.js';
import {
  COUNT_CLASS_DAYS,
  type SuggestedCountClass,
  suggestCountClasses,
} from '../domain/count-class.js';
import type { VariantId } from '../domain/order.js';
import { OrderingQueries } from './ordering.queries.js';

export {
  COUNT_CLASS_DAYS,
  type SuggestedCountClass,
} from '../domain/count-class.js';

/** The product of a variant, as Catalog has it now. */
export interface ProductOfVariant {
  readonly productId: string;
  readonly productTitle: string;
  /** Its count class now (ADR-0173); `null` without one. */
  readonly countClass: SuggestedCountClass | null;
}

/**
 * The products of Catalog's variants (ADR-0005): an adapter in the infrastructure answers it with Catalog's facade. An
 * abstract class rather than an interface, so it can be the dependency injection token without depending on NestJS.
 */
export abstract class SalesCatalog {
  /** The product of each of these variants; an unknown variant is left out. */
  abstract productsOf(
    variantIds: readonly VariantId[],
  ): Promise<ReadonlyMap<VariantId, ProductOfVariant>>;
}

/** A product with what it sold and the class it would have. */
export interface CountClassSuggestion extends ProductOfVariant {
  /** In cents: the totals of its lines, less their discounts. */
  readonly amount: number;
  readonly units: number;
  readonly suggestedClass: SuggestedCountClass;
}

export interface CountClassSuggestions {
  /** From when, included, to when, excluded. */
  readonly from: Date;
  readonly to: Date;
  /** What every product sold, in cents. */
  readonly total: number;
  /** From the one that sold the most; the products that sold nothing are left out, and are C. */
  readonly products: readonly CountClassSuggestion[];
}

/**
 * The count class of each product by its sales of the last 90 days (ADR-0173): A for the products of the first 80 %
 * of the amount, B for the next 15 % and C for the rest. It counts the lines of the orders placed then, online and in
 * the store, that were paid and not cancelled, expired nor refunded, each line by its total less its discount. Ordering
 * owns the sales, so the suggestion is computed here; the staff applies it in Catalog, which does not depend on
 * Ordering.
 */
@Injectable()
export class CountClassSuggester {
  constructor(
    private readonly queries: OrderingQueries,
    private readonly catalog: SalesCatalog,
    private readonly clock: Clock,
  ) {}

  async suggest(): Promise<CountClassSuggestions> {
    const to = this.clock.now();
    const from = new Date(to.getTime() - COUNT_CLASS_DAYS * 86_400_000);
    const sales = await this.queries.salesByVariant(from, to);
    const products = await this.catalog.productsOf(
      sales.map(({ variantId }) => variantId),
    );
    const byProduct = new Map<
      string,
      ProductOfVariant & { amount: number; units: number }
    >();
    for (const { variantId, amount, units } of sales) {
      const product = products.get(variantId);
      // Variants are never deleted (ADR-0038).
      if (product === undefined) continue;
      const current = byProduct.get(product.productId) ?? {
        ...product,
        amount: 0,
        units: 0,
      };
      byProduct.set(product.productId, {
        ...current,
        amount: current.amount + amount,
        units: current.units + units,
      });
    }
    const suggested = suggestCountClasses([...byProduct.values()]);
    return {
      from,
      to,
      total: suggested.reduce((sum, { amount }) => sum + amount, 0),
      products: suggested,
    };
  }
}
