import type { PriceListId } from './price-list.js';

/**
 * `price_lists`. An abstract class rather than an interface, so it can be the dependency injection token
 * without depending on NestJS.
 */
export abstract class PriceListRepository {
  abstract exists(id: PriceListId): Promise<boolean>;

  /** The default list (BR-PRC-06), or `null` before its migration runs. */
  abstract findDefault(): Promise<PriceListId | null>;
}
