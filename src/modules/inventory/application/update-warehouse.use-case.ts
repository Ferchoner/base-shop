import { Injectable } from '@nestjs/common';
import {
  AuditTrail,
  changesBetween,
  NotFoundError,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import {
  InvalidWarehouseLocationError,
  type Warehouse,
  type WarehouseAddress,
  type WarehouseId,
} from '../domain/warehouse.js';
import { WarehouseRepository } from '../domain/warehouse.repository.js';
import { WarehouseLocations } from './warehouse-locations.js';

/** An address as the API receives it (`AddressInput`, API_SPEC.md §8.2). */
export type WarehouseAddressInput = Omit<
  WarehouseAddress,
  'stateName' | 'municipalityName' | 'country'
>;

/** What the audit trail keeps of the warehouse; the address only as changed, since it holds personal data. */
function auditedFields(warehouse: Warehouse): Record<string, unknown> {
  const { name, address } = warehouse.snapshot();
  return { name, address };
}

/**
 * Changes the name or the address of the warehouse (UC-INV-01, ADR-0081, ADR-0127). The address is checked
 * against the INEGI catalog and keeps the names of its state and municipality (ADR-0057). Without changes,
 * nothing is saved or audited.
 */
@Injectable()
export class UpdateWarehouse {
  constructor(
    private readonly warehouses: WarehouseRepository,
    private readonly locations: WarehouseLocations,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
  ) {}

  execute(
    id: WarehouseId,
    changes: { name?: string; address?: WarehouseAddressInput | null },
  ): Promise<void> {
    return this.transactions.run(async () => {
      const warehouse = await this.warehouses.find(id);
      if (warehouse === null) throw new NotFoundError('Warehouse', id);
      const before = auditedFields(warehouse);
      warehouse.describe({
        name: changes.name,
        address:
          changes.address === undefined || changes.address === null
            ? changes.address
            : await this.located(changes.address),
      });
      const audited = changesBetween(before, auditedFields(warehouse));
      if (Object.keys(audited).length === 0) return;
      await this.warehouses.save(warehouse);
      await this.audit.record({
        action: 'warehouses.update',
        resource: { type: 'warehouse', id },
        changes: audited,
      });
    });
  }

  /** @throws InvalidWarehouseLocationError when the state or municipality is not valid. */
  private async located(
    address: WarehouseAddressInput,
  ): Promise<WarehouseAddress> {
    const names = await this.locations.resolve(
      address.stateCode,
      address.municipalityCode,
    );
    if (typeof names === 'string') {
      throw new InvalidWarehouseLocationError(names);
    }
    return { ...address, ...names, country: 'MX' };
  }
}
