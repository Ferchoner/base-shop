import type { Id } from '../../../shared-kernel/index.js';

/**
 * A price list (DATABASE.md §5.1). The MVP has only the default one, created by a migration and never
 * deactivated (ADR-0039, BR-PRC-06, ADR-0125); the API cannot create or edit lists.
 */
export type PriceListId = Id<'PriceList'>;
