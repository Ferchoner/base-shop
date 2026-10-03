import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { Prisma } from '../../../platform/persistence/prisma/generated/client.js';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import {
  Money,
  type Page,
  type PageRequest,
  pageOffset,
  type SortOrder,
  toId,
} from '../../../shared-kernel/index.js';
import {
  type OrderShipmentView,
  type ShipmentFilter,
  type ShipmentSortField,
  type ShipmentView,
  ShippingQueries,
  type ShippingMethodView,
} from '../application/shipping.queries.js';
import type {
  OrderId,
  ShipmentDestination,
  ShipmentId,
} from '../domain/shipment.js';
import {
  SHIPMENT_ROW,
  type ShipmentRow,
} from './prisma-shipment.repository.js';

/** Read models of Shipping, straight from `shipping_methods`, `shipments` and `shipment_items`. */
@Injectable()
export class PrismaShippingQueries extends ShippingQueries {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  async findActiveMethod(): Promise<ShippingMethodView | null> {
    const row = await this.txHost.tx.shippingMethod.findFirst({
      where: { isActive: true },
    });
    return row === null
      ? null
      : {
          id: toId<'ShippingMethod'>(row.id),
          name: row.name,
          flatFee: Money.of(row.flatFee, 'MXN'),
          freeShippingThreshold:
            row.freeShippingThreshold === null
              ? null
              : Money.of(row.freeShippingThreshold, 'MXN'),
          deliveryMinBusinessDays: row.deliveryMinBusinessDays,
          deliveryMaxBusinessDays: row.deliveryMaxBusinessDays,
          isActive: row.isActive,
          version: row.version,
          updatedAt: row.updatedAt,
        };
  }

  async shipmentsOf(
    orderIds: readonly OrderId[],
  ): Promise<ReadonlyMap<OrderId, OrderShipmentView>> {
    if (orderIds.length === 0) return new Map();
    const rows = await this.txHost.tx.shipment.findMany({
      where: { orderId: { in: [...orderIds] } },
    });
    return new Map(
      rows.map((row) => [toId<'Order'>(row.orderId), toOrderShipmentView(row)]),
    );
  }

  async findShipment(id: ShipmentId): Promise<ShipmentView | null> {
    const row = await this.txHost.tx.shipment.findUnique({
      ...SHIPMENT_ROW,
      where: { id },
    });
    return row === null ? null : toShipmentView(row);
  }

  async listShipments(
    filter: ShipmentFilter,
    sort: readonly SortOrder<ShipmentSortField>[],
    page: PageRequest,
  ): Promise<Page<ShipmentView>> {
    const q = filter.q?.trim();
    const where: Prisma.ShipmentWhereInput = {
      ...(filter.status === undefined
        ? {}
        : { status: { in: [...filter.status] } }),
      ...(filter.orderId === undefined ? {} : { orderId: filter.orderId }),
      ...(q === undefined || q === ''
        ? {}
        : {
            OR: [
              { orderCode: q.replaceAll('-', '').toUpperCase() },
              { trackingNumber: { equals: q, mode: 'insensitive' as const } },
            ],
          }),
      ...(filter.createdFrom === undefined && filter.createdTo === undefined
        ? {}
        : { createdAt: { gte: filter.createdFrom, lte: filter.createdTo } }),
    };
    const [rows, totalItems] = await Promise.all([
      this.txHost.tx.shipment.findMany({
        ...SHIPMENT_ROW,
        where,
        orderBy: [
          ...sort.map(({ field, direction }) => ({ [field]: direction })),
          { id: 'asc' as const },
        ],
        skip: pageOffset(page),
        take: page.pageSize,
      }),
      this.txHost.tx.shipment.count({ where }),
    ]);
    return { items: rows.map(toShipmentView), totalItems };
  }
}

function toOrderShipmentView(
  row: Prisma.ShipmentGetPayload<object>,
): OrderShipmentView {
  return {
    id: toId<'Shipment'>(row.id),
    status: row.status,
    carrierName: row.carrierName,
    trackingNumber: row.trackingNumber,
    ownDelivery: row.ownDelivery,
    dispatchedAt: row.dispatchedAt,
    deliveredAt: row.deliveredAt,
    version: row.version,
  };
}

function toShipmentView(row: ShipmentRow): ShipmentView {
  return {
    ...toOrderShipmentView(row),
    orderId: toId<'Order'>(row.orderId),
    orderCode: row.orderCode,
    warehouseId: toId<'Warehouse'>(row.warehouseId),
    destination: row.destination as unknown as ShipmentDestination,
    items: row.items.map((item) => ({
      orderLineId: toId<'OrderLine'>(item.orderLineId),
      sku: item.sku,
      productName: item.productName,
      quantity: item.quantity,
    })),
    failedAt: row.failedAt,
    returnedAt: row.returnedAt,
    cancelledAt: row.cancelledAt,
    failureNote: row.failureNote,
    returnNote: row.returnNote,
    createdAt: row.createdAt,
  };
}
