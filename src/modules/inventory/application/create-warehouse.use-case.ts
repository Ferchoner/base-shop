import { Injectable } from '@nestjs/common';
import {
  AuditTrail,
  changesBetween,
  newId,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import { Warehouse, type WarehouseId } from '../domain/warehouse.js';
import { WarehouseRepository } from '../domain/warehouse.repository.js';
import {
  auditedFields,
  locatedAddress,
  type WarehouseAddressInput,
} from './update-warehouse.use-case.js';
import { WarehouseLocations } from './warehouse-locations.js';

/**
 * Creates an active warehouse (UC-INV-10, ADR-0160): orders are reserved in it by its priority from then on. The
 * address, when given, is checked against the INEGI catalog (ADR-0057). Audited as `warehouses.create`.
 */
@Injectable()
export class CreateWarehouse {
  constructor(
    private readonly warehouses: WarehouseRepository,
    private readonly locations: WarehouseLocations,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
  ) {}

  /**
   * @throws InvalidValueError for a code, name or priority out of their rules.
   * @throws InvalidWarehouseLocationError when the state or municipality is not valid.
   * @throws DuplicateValueError on `code`.
   */
  execute(input: {
    code: string;
    name: string;
    address: WarehouseAddressInput | null;
    priority: number;
  }): Promise<WarehouseId> {
    return this.transactions.run(async () => {
      const warehouse = Warehouse.create({
        id: newId<'Warehouse'>(),
        code: input.code,
        name: input.name,
        address:
          input.address === null
            ? null
            : await locatedAddress(this.locations, input.address),
        priority: input.priority,
      });
      await this.warehouses.insert(warehouse);
      const { id, code, status } = warehouse.snapshot();
      await this.audit.record({
        action: 'warehouses.create',
        resource: { type: 'warehouse', id },
        changes: changesBetween(
          {
            code: null,
            name: null,
            address: null,
            priority: null,
            status: null,
          },
          { ...auditedFields(warehouse), code, status },
        ),
      });
      return id;
    });
  }
}
