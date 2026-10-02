import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../../platform/auth/authorization.decorators.js';
import {
  rangeEnd,
  toPageResponse,
  toSortOrders,
} from '../../../platform/http/pagination/pagination.js';
import { pathId } from '../../../platform/http/path-id.js';
import { ApiProblemResponses } from '../../../platform/http/problem-details/api-problem-responses.decorator.js';
import { NotFoundError, toId } from '../../../shared-kernel/index.js';
import { ShipmentTracking } from '../application/shipment-tracking.use-case.js';
import {
  type ShipmentSortField,
  type ShipmentView,
  ShippingQueries,
} from '../application/shipping.queries.js';
import {
  AdminShipmentDto,
  AdminShipmentListDto,
  AdminShipmentListQueryDto,
  RecordTrackingDto,
} from './admin-shipment.dto.js';

const shipmentIdOf = (id: string) => pathId<'Shipment'>(id, 'Shipment');

/**
 * The shipments for the staff (UC-SHI-04 and 08, API_SPEC.md §17, ADR-0140), with `shipping.manage`. A shipment
 * is created when its order is paid; the staff records its carrier and tracking number before dispatching it.
 */
@ApiTags('Administración: envíos')
@ApiProblemResponses('unauthenticated', 'forbidden', 'password-change-required')
@Controller('admin/shipping/shipments')
export class AdminShipmentsController {
  constructor(
    private readonly queries: ShippingQueries,
    private readonly tracking: ShipmentTracking,
  ) {}

  @ApiOperation({
    summary: 'Listar envíos',
    description:
      'Por defecto, los `PENDING` del más antiguo al más reciente: la lista de trabajo del staff (UC-SHI-08).',
  })
  @ApiOkResponse({ type: AdminShipmentListDto })
  @RequirePermissions('shipping.manage')
  @Get()
  async list(
    @Query() query: AdminShipmentListQueryDto,
  ): Promise<AdminShipmentListDto> {
    const page = await this.queries.listShipments(
      {
        status: query.status ?? ['PENDING'],
        orderId:
          query.orderId === undefined
            ? undefined
            : toId<'Order'>(query.orderId),
        q: query.q,
        createdFrom:
          query.createdFrom === undefined
            ? undefined
            : new Date(query.createdFrom),
        createdTo: rangeEnd(query.createdTo),
      },
      toSortOrders<ShipmentSortField>(query.sort, 'createdAt'),
      query,
    );
    return toPageResponse(page, query, toAdminShipmentDto);
  }

  @ApiOperation({ summary: 'Consultar un envío' })
  @ApiOkResponse({ type: AdminShipmentDto })
  @ApiProblemResponses('not-found')
  @RequirePermissions('shipping.manage')
  @Get(':shipmentId')
  get(@Param('shipmentId') shipmentId: string): Promise<AdminShipmentDto> {
    return this.read(shipmentIdOf(shipmentId));
  }

  @ApiOperation({
    summary: 'Registrar la paquetería y la guía de un envío',
    description:
      'En `PENDING`, o en `DISPATCHED` por paquetería para corregirlas; nunca en un envío despachado como entrega propia (ADR-0078). Se audita como `shipments.update`; sin cambios no se guarda ni se audita.',
  })
  @ApiOkResponse({ type: AdminShipmentDto })
  @ApiProblemResponses(
    'not-found',
    'version-conflict',
    'invalid-state-transition',
  )
  @RequirePermissions('shipping.manage')
  @Patch(':shipmentId')
  async recordTracking(
    @Param('shipmentId') shipmentId: string,
    @Body() body: RecordTrackingDto,
  ): Promise<AdminShipmentDto> {
    const id = shipmentIdOf(shipmentId);
    await this.tracking.record({
      shipmentId: id,
      carrierName: body.carrierName.trim(),
      trackingNumber: body.trackingNumber.trim(),
      version: body.version,
    });
    return this.read(id);
  }

  private async read(
    id: ReturnType<typeof shipmentIdOf>,
  ): Promise<AdminShipmentDto> {
    const shipment = await this.queries.findShipment(id);
    if (shipment === null) throw new NotFoundError('Shipment', id);
    return toAdminShipmentDto(shipment);
  }
}

function toAdminShipmentDto(view: ShipmentView): AdminShipmentDto {
  return {
    id: view.id,
    orderId: view.orderId,
    orderCode: `${view.orderCode.slice(0, 4)}-${view.orderCode.slice(4)}`,
    warehouseId: view.warehouseId,
    status: view.status,
    destination: { ...view.destination },
    items: view.items.map((item) => ({ ...item })),
    carrierName: view.carrierName,
    trackingNumber: view.trackingNumber,
    ownDelivery: view.ownDelivery,
    dispatchedAt: view.dispatchedAt,
    deliveredAt: view.deliveredAt,
    failedAt: view.failedAt,
    returnedAt: view.returnedAt,
    cancelledAt: view.cancelledAt,
    version: view.version,
    createdAt: view.createdAt,
  };
}
