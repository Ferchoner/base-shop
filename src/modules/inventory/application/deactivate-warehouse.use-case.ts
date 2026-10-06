import { Injectable } from '@nestjs/common';
import {
  AuditTrail,
  NotFoundError,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import type { WarehouseId } from '../domain/warehouse.js';
import { WarehouseRepository } from '../domain/warehouse.repository.js';

/**
 * Deactivates a warehouse for good (UC-INV-11, ADR-0076, ADR-0160): it no longer sells, reserves nor receives
 * stock, and keeps what it has, which adjustments can move. It locks every active warehouse, so it waits for the
 * reservations and receipts under way in this one, and two deactivations never leave no warehouse active.
 * Audited as `warehouses.deactivate`.
 */
@Injectable()
export class DeactivateWarehouse {
  constructor(
    private readonly warehouses: WarehouseRepository,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
  ) {}

  /**
   * @throws NotFoundError; InvalidStateTransitionError when it is inactive already;
   *   LastActiveWarehouseError when it is the only active one; ResourceInUseError when it holds units for orders.
   */
  execute(id: WarehouseId): Promise<void> {
    return this.transactions.run(async () => {
      const active = await this.warehouses.lockActive();
      const warehouse =
        active.find((candidate) => candidate.id === id) ??
        (await this.warehouses.find(id));
      if (warehouse === null) throw new NotFoundError('Warehouse', id);
      warehouse.deactivate({
        activeWarehouses: active.length,
        reservedUnits: warehouse.isActive
          ? await this.warehouses.reservedUnits(id)
          : 0,
      });
      await this.warehouses.save(warehouse);
      await this.audit.record({
        action: 'warehouses.deactivate',
        resource: { type: 'warehouse', id },
        changes: { status: { from: 'ACTIVE', to: 'INACTIVE' } },
      });
    });
  }
}
