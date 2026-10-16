import type { Money } from '../../../shared-kernel/index.js';
import type { UserId, WarehouseId } from '../domain/work-order.js';

/**
 * The warehouses of Inventory, through its facade (ADR-0005): the store that receives the equipment is the warehouse
 * of the physical store, as in a counter sale (ADR-0161).
 */
export abstract class WorkOrderWarehouses {
  /** Whether it exists and is active, locked in shared mode until the transaction ends, so it is not deactivated meanwhile. */
  abstract isActive(warehouseId: WarehouseId): Promise<boolean>;
}

/** The accounts of Identity, through its facade (ADR-0005). */
export abstract class WorkOrderAccounts {
  /**
   * Whether it is an ACTIVE customer, locked in shared mode until the transaction ends, so an anonymization waits
   * for the work order (ADR-0145).
   */
  abstract isActiveCustomer(customerId: UserId): Promise<boolean>;

  /** Whether it is an ACTIVE staff member, who can be the technician of a work order. */
  abstract isActiveStaff(staffId: UserId): Promise<boolean>;
}

/**
 * Whether the store has the money of a sale: `PAID` once it was paid; `PENDING` while it waits for its payment;
 * `NONE` when it expired, was cancelled or was refunded (ADR-0167).
 */
export type SalePayment = 'PAID' | 'PENDING' | 'NONE';

/** A counter sale, as Ordering gives it (ADR-0161, ADR-0167). */
export interface StoreSale {
  readonly orderId: string;
  /** With dash, as people see it. */
  readonly publicCode: string;
  /** The internal number, for the staff (ADR-0049). */
  readonly orderNumber: number;
  readonly status: string;
  readonly grandTotal: Money;
  readonly placedAt: Date;
  readonly paidAt: Date | null;
  readonly payment: SalePayment;
}

/** The sales of the physical store, through the facade of Ordering (ADR-0005). */
export abstract class StoreSales {
  /** The sales of the store among these orders, oldest first; online orders and unknown IDs are left out. */
  abstract of(orderIds: readonly string[]): Promise<readonly StoreSale[]>;
}

/**
 * The responses that `@Idempotent` kept of receiving equipment (ADR-0099), which hold the data of the customer for 24
 * hours. An anonymization forgets them (ADR-0145, ADR-0167).
 */
export abstract class ReceptionResponses {
  abstract forgetOf(workOrderIds: readonly string[]): Promise<void>;
}
