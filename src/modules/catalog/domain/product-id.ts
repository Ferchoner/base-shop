import type { Id } from '../../../shared-kernel/index.js';

/** Identifier of a product (DATABASE.md §4.3). Its aggregate arrives with T-140. */
export type ProductId = Id<'Product'>;
