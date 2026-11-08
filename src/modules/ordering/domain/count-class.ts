/** How often a product is counted (ADR-0173): A every week, B every month, C every quarter. */
export type SuggestedCountClass = 'A' | 'B' | 'C';

/** Share of the sales of the products of class A, and of A and B together, in percent (ADR-0173). */
export const CLASS_A_SHARE = 80;
export const CLASS_AB_SHARE = 95;

/** Days of sales the suggestion reads (ADR-0173). */
export const COUNT_CLASS_DAYS = 90;

/** What a product sold, in cents, with its ID. */
export interface ProductSales {
  readonly productId: string;
  readonly amount: number;
}

/**
 * The class each product would have by its sales (ADR-0173), from the one that sold the most: A while what the
 * products before it sold is under 80 % of the total, so the product that reaches 80 % is still A; then B while it is
 * under 95 %; C for the rest. A tie goes by product ID, so the answer never changes between two reads. Products that
 * sold nothing are not given: they are C.
 */
export function suggestCountClasses<T extends ProductSales>(
  sales: readonly T[],
): (T & { readonly suggestedClass: SuggestedCountClass })[] {
  const sorted = sales
    .filter(({ amount }) => amount > 0)
    .sort((a, b) =>
      b.amount !== a.amount
        ? b.amount - a.amount
        : a.productId < b.productId
          ? -1
          : 1,
    );
  const total = sorted.reduce((sum, { amount }) => sum + amount, 0);
  let before = 0;
  return sorted.map((product) => {
    // In integers: `before / total < 80 %`.
    const suggestedClass: SuggestedCountClass =
      before * 100 < CLASS_A_SHARE * total
        ? 'A'
        : before * 100 < CLASS_AB_SHARE * total
          ? 'B'
          : 'C';
    before += product.amount;
    return { ...product, suggestedClass };
  });
}
