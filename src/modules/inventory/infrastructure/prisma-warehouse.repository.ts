import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { Prisma } from '../../../platform/persistence/prisma/generated/client.js';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import { toId } from '../../../shared-kernel/index.js';
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
    const row = await this.txHost.tx.warehouse.findUnique({ where: { id } });
    return row === null
      ? null
      : Warehouse.restore({
          id: toId<'Warehouse'>(row.id),
          code: row.code,
          name: row.name,
          address: row.address as WarehouseAddress | null,
          status: row.status,
        });
  }

  async save(warehouse: Warehouse): Promise<void> {
    const { id, name, address } = warehouse.snapshot();
    await this.txHost.tx.warehouse.update({
      where: { id },
      data: {
        name,
        // A JSON column is cleared with `DbNull`: a plain `null` would not reach the database.
        address:
          address === null
            ? Prisma.DbNull
            : (address as unknown as Prisma.InputJsonValue),
        // The time comes from the application, as for every `@updatedAt` of Prisma (DEVELOPMENT_GUIDE.md).
        updatedAt: new Date(),
      },
    });
  }
}
