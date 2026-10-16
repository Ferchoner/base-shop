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
