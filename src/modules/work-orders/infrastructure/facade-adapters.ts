import { Injectable } from '@nestjs/common';
import { IdentityAccessFacade } from '../../identity-access/index.js';
import { InventoryFacade } from '../../inventory/index.js';
import { OrderingFacade } from '../../ordering/index.js';
import {
  type StoreSale,
  StoreSales,
  WorkOrderAccounts,
  WorkOrderWarehouses,
} from '../application/work-order-ports.js';
import type { UserId, WarehouseId } from '../domain/work-order.js';

@Injectable()
export class InventoryFacadeWorkOrderWarehouses extends WorkOrderWarehouses {
  constructor(private readonly inventory: InventoryFacade) {
    super();
  }

  isActive(warehouseId: WarehouseId): Promise<boolean> {
    return this.inventory.isActiveWarehouse(warehouseId);
  }
}

@Injectable()
export class IdentityFacadeWorkOrderAccounts extends WorkOrderAccounts {
  constructor(private readonly identity: IdentityAccessFacade) {
    super();
  }

  async isActiveCustomer(customerId: UserId): Promise<boolean> {
    return (await this.identity.customerContact(customerId)) !== null;
  }

  isActiveStaff(staffId: UserId): Promise<boolean> {
    return this.identity.isActiveStaff(staffId);
  }
}

@Injectable()
export class OrderingFacadeStoreSales extends StoreSales {
  constructor(private readonly ordering: OrderingFacade) {
    super();
  }

  of(orderIds: readonly string[]): Promise<readonly StoreSale[]> {
    return this.ordering.storeSales(orderIds);
  }
}
