import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { Prisma } from '../../../platform/persistence/prisma/generated/client.js';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import { toId, VersionConflictError } from '../../../shared-kernel/index.js';
import {
  type OrderId,
  Shipment,
  type ShipmentDestination,
  type ShipmentId,
} from '../domain/shipment.js';
import { ShipmentRepository } from '../domain/shipment.repository.js';

/** Items in the order of their lines: their IDs are UUIDv7, created in that order with the order (ADR-0140). */
export const SHIPMENT_ROW = {
  include: { items: { orderBy: { orderLineId: 'asc' } } },
} satisfies Prisma.ShipmentDefaultArgs;

export type ShipmentRow = Prisma.ShipmentGetPayload<typeof SHIPMENT_ROW>;

/**
 * Shipments in PostgreSQL (DATABASE.md §10.2 and §10.3). A shipment is written with `INSERT … ON CONFLICT DO
 * NOTHING`, so a second one for the same order writes nothing (BR-SHP-02); a change locks its row first
 * (`SELECT … FOR UPDATE`) and compares its `version`. Dates come from the application.
 */
@Injectable()
export class PrismaShipmentRepository extends ShipmentRepository {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  async insert(shipment: Shipment, now: Date): Promise<boolean> {
    const s = shipment.snapshot;
    const tx = this.txHost.tx;
    const { count } = await tx.shipment.createMany({
      data: [
        {
          id: s.id,
          orderId: s.orderId,
          orderCode: s.orderCode,
          warehouseId: s.warehouseId,
          status: s.status,
          destination: s.destination as unknown as Prisma.InputJsonObject,
          ownDelivery: s.ownDelivery,
          version: s.version,
          createdAt: now,
          updatedAt: now,
        },
      ],
      skipDuplicates: true,
    });
    if (count === 0) return false;
    await tx.shipmentItem.createMany({
      data: s.items.map((item) => ({ shipmentId: s.id, ...item })),
    });
    return true;
  }

  async lock(id: ShipmentId): Promise<Shipment | null> {
    const [locked] = await this.txHost.tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM shipments WHERE id = ${id}::uuid FOR UPDATE`;
    return locked === undefined ? null : this.read(locked.id);
  }

  async lockByOrder(orderId: OrderId): Promise<Shipment | null> {
    const [locked] = await this.txHost.tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM shipments WHERE order_id = ${orderId}::uuid FOR UPDATE`;
    return locked === undefined ? null : this.read(locked.id);
  }

  async save(shipment: Shipment, now: Date): Promise<void> {
    const s = shipment.snapshot;
    const tx = this.txHost.tx;
    const { count } = await tx.shipment.updateMany({
      where: { id: s.id, version: s.version },
      data: {
        status: s.status,
        carrierName: s.carrierName,
        trackingNumber: s.trackingNumber,
        ownDelivery: s.ownDelivery,
        dispatchedAt: s.dispatchedAt,
        deliveredAt: s.deliveredAt,
        failedAt: s.failedAt,
        returnedAt: s.returnedAt,
        cancelledAt: s.cancelledAt,
        failureNote: s.failureNote,
        returnNote: s.returnNote,
        destination: s.destination as unknown as Prisma.InputJsonObject,
        anonymizedAt: s.anonymizedAt,
        blockedAt: s.blockedAt,
        version: { increment: 1 },
        updatedAt: now,
      },
    });
    if (count === 0) {
      const current = await tx.shipment.findUniqueOrThrow({
        where: { id: s.id },
        select: { version: true },
      });
      throw new VersionConflictError(current.version);
    }
  }

  private async read(id: string): Promise<Shipment> {
    const row = await this.txHost.tx.shipment.findUniqueOrThrow({
      ...SHIPMENT_ROW,
      where: { id },
    });
    return Shipment.restore({
      id: toId<'Shipment'>(row.id),
      orderId: toId<'Order'>(row.orderId),
      orderCode: row.orderCode,
      warehouseId: toId<'Warehouse'>(row.warehouseId),
      status: row.status,
      destination: row.destination as unknown as ShipmentDestination,
      items: row.items.map((item) => ({
        orderLineId: toId<'OrderLine'>(item.orderLineId),
        sku: item.sku,
        productName: item.productName,
        quantity: item.quantity,
      })),
      carrierName: row.carrierName,
      trackingNumber: row.trackingNumber,
      ownDelivery: row.ownDelivery,
      dispatchedAt: row.dispatchedAt,
      deliveredAt: row.deliveredAt,
      failedAt: row.failedAt,
      returnedAt: row.returnedAt,
      cancelledAt: row.cancelledAt,
      failureNote: row.failureNote,
      returnNote: row.returnNote,
      anonymizedAt: row.anonymizedAt,
      blockedAt: row.blockedAt,
      version: row.version,
    });
  }
}
