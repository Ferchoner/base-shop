import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { Prisma } from '../../../platform/persistence/prisma/generated/client.js';
import { uniqueViolationIndex } from '../../../platform/persistence/prisma-errors.js';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import { DuplicateValueError, toId } from '../../../shared-kernel/index.js';
import {
  Warehouse,
  type WarehouseAddress,
  type WarehouseId,
} from '../domain/warehouse.js';
import { WarehouseRepository } from '../domain/warehouse.repository.js';

/** `warehouses` (DATABASE.md §6.1), always through the active transaction. */
@Injectable()
export class PrismaWarehouseRepository extends WarehouseRepository {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  async find(id: WarehouseId): Promise<Warehouse | null> {
    return toWarehouse(
      await this.txHost.tx.warehouse.findUnique({ where: { id } }),
    );
  }

  async lockActive(): Promise<Warehouse[]> {
    const rows = await this.txHost.tx.$queryRaw<WarehouseRow[]>`
      SELECT id, code, name, address, status, priority FROM warehouses
       WHERE status = 'ACTIVE'
       ORDER BY id
         FOR UPDATE`;
    return rows.map((row) => toWarehouse(row)!);
  }

  async lockForStock(id: WarehouseId): Promise<Warehouse | null> {
    const [row] = await this.txHost.tx.$queryRaw<WarehouseRow[]>`
      SELECT id, code, name, address, status, priority FROM warehouses
       WHERE id = ${id}::uuid
         FOR SHARE`;
    return toWarehouse(row ?? null);
  }

  async reservedUnits(id: WarehouseId): Promise<number> {
    const { _sum } = await this.txHost.tx.stockItem.aggregate({
      where: { warehouseId: id },
      _sum: { reserved: true },
    });
    return _sum.reserved ?? 0;
  }

  async insert(warehouse: Warehouse): Promise<void> {
    const { address, ...data } = warehouse.snapshot();
    try {
      await this.txHost.tx.warehouse.create({
        data: {
          ...data,
          address: jsonAddress(address),
          updatedAt: new Date(),
        },
      });
    } catch (error) {
      if (uniqueViolationIndex(error) === 'warehouses_code_key') {
        throw new DuplicateValueError('code');
      }
      throw error;
    }
  }

  async save(warehouse: Warehouse): Promise<void> {
    const { id, name, address, status, priority } = warehouse.snapshot();
    await this.txHost.tx.warehouse.update({
      where: { id },
      data: {
        name,
        address: jsonAddress(address),
        status,
        priority,
        // The time comes from the application, as for every `@updatedAt` of Prisma (DEVELOPMENT_GUIDE.md).
        updatedAt: new Date(),
      },
    });
  }
}

interface WarehouseRow {
  id: string;
  code: string;
  name: string;
  address: unknown;
  status: 'ACTIVE' | 'INACTIVE';
  priority: number;
}

/** A JSON column is cleared with `DbNull`: a plain `null` would not reach the database. */
function jsonAddress(
  address: WarehouseAddress | null,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return address === null
    ? Prisma.DbNull
    : (address as unknown as Prisma.InputJsonValue);
}

function toWarehouse(row: WarehouseRow | null): Warehouse | null {
  return row === null
    ? null
    : Warehouse.restore({
        id: toId<'Warehouse'>(row.id),
        code: row.code,
        name: row.name,
        address: (row.address ?? null) as WarehouseAddress | null,
        status: row.status,
        priority: row.priority,
      });
}
