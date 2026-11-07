import type { Page, PageRequest } from '../../../shared-kernel/index.js';
import type { CashClosing, CashClosingId } from './cash-closing.js';
import type { WarehouseId } from './order.js';

/** Which closings a listing shows (ADR-0171); the days are of central Mexico, `YYYY-MM-DD`, both included. */
export interface CashClosingFilter {
  readonly warehouseId?: WarehouseId;
  readonly dateFrom?: string;
  readonly dateTo?: string;
}

/**
 * The cash closings (`cash_closings`, ADR-0171): inserted once and never changed. An abstract class rather than an
 * interface, so it can be the dependency injection token without depending on NestJS.
 */
export abstract class CashClosingRepository {
  /** Saves a new closing; false, saving nothing, when the warehouse has one for that day already. */
  abstract insert(closing: CashClosing): Promise<boolean>;

  abstract findById(id: CashClosingId): Promise<CashClosing | null>;

  /** The closing of the warehouse for that day; `null` while it has none. */
  abstract findByDay(
    warehouseId: WarehouseId,
    date: string,
  ): Promise<CashClosing | null>;

  /** The newest day first, and then by ID. */
  abstract list(
    filter: CashClosingFilter,
    page: PageRequest,
  ): Promise<Page<CashClosing>>;
}
