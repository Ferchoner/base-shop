import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../../platform/auth/authorization.decorators.js';
import {
  rangeEnd,
  toPageResponse,
  toSortOrders,
} from '../../../platform/http/pagination/pagination.js';
import { pathId } from '../../../platform/http/path-id.js';
import { ApiProblemResponses } from '../../../platform/http/problem-details/api-problem-responses.decorator.js';
import { ProblemException } from '../../../platform/http/problem-details/problem.exception.js';
import { NotFoundError, toId } from '../../../shared-kernel/index.js';
import { ShipmentDelivery } from '../application/shipment-delivery.use-case.js';
import {
  ShipmentTracking,
  type Tracking,
} from '../application/shipment-tracking.use-case.js';
import {
  type ShipmentSortField,
  type ShipmentView,
  ShippingQueries,
} from '../application/shipping.queries.js';
import {
  AdminShipmentDto,
  AdminShipmentListDto,
  AdminShipmentListQueryDto,
  DispatchShipmentDto,
  RecordTrackingDto,
  ShipmentNoteDto,
  ShipmentVersionDto,
} from './admin-shipment.dto.js';

const shipmentIdOf = (id: string) => pathId<'Shipment'>(id, 'Shipment');

/**
 * The shipments for the staff (UC-SHI-04 to 09, API_SPEC.md §17, ADR-0140, ADR-0141), with `shipping.manage`. A
 * shipment is created when its order is paid; the staff records its carrier and tracking number, dispatches it and
 * records how it ended. Its order follows in the background (API_SPEC.md §2.5).
 */
@ApiTags('Administración: envíos')
@ApiProblemResponses('unauthenticated', 'forbidden', 'password-change-required')
@Controller('admin/shipping/shipments')
export class AdminShipmentsController {
  constructor(
    private readonly queries: ShippingQueries,
    private readonly tracking: ShipmentTracking,
    private readonly delivery: ShipmentDelivery,
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
      'En `PENDING`, o en `DISPATCHED` por paquetería para corregirlas; nunca en un envío despachado como entrega propia (ADR-0078). Las dos en `null` las quitan de un envío `PENDING` (ADR-0141). Se audita como `shipments.update`; sin cambios no se guarda ni se audita.',
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
      ...trackingOf(body),
      version: body.version,
    });
    return this.read(id);
  }

  @ApiOperation({
    summary: 'Despachar un envío',
    description:
      'Desde `PENDING`: por paquetería, con la paquetería y la guía ya capturadas, o como entrega propia, sin ellas (BR-SHP-04, ADR-0078). La orden pasa a `SHIPPED` en segundo plano. Se audita como `shipments.dispatch`.',
  })
  @ApiOkResponse({ type: AdminShipmentDto })
  @ApiProblemResponses(
    'not-found',
    'version-conflict',
    'invalid-state-transition',
  )
  @RequirePermissions('shipping.manage')
  @HttpCode(200)
  @Post(':shipmentId/dispatch')
  async dispatch(
    @Param('shipmentId') shipmentId: string,
    @Body() body: DispatchShipmentDto,
  ): Promise<AdminShipmentDto> {
    const id = shipmentIdOf(shipmentId);
    await this.delivery.dispatch({
      shipmentId: id,
      ownDelivery: body.ownDelivery ?? false,
      version: body.version,
    });
    return this.read(id);
  }

  @ApiOperation({
    summary: 'Marcar un envío como entregado',
    description:
      'Desde `DISPATCHED`; es definitivo (BR-SHP-03). La orden pasa a `DELIVERED` en segundo plano. Se audita como `shipments.deliver`.',
  })
  @ApiOkResponse({ type: AdminShipmentDto })
  @ApiProblemResponses(
    'not-found',
    'version-conflict',
    'invalid-state-transition',
  )
  @RequirePermissions('shipping.manage')
  @HttpCode(200)
  @Post(':shipmentId/deliver')
  async deliver(
    @Param('shipmentId') shipmentId: string,
    @Body() body: ShipmentVersionDto,
  ): Promise<AdminShipmentDto> {
    const id = shipmentIdOf(shipmentId);
    await this.delivery.deliver({ shipmentId: id, version: body.version });
    return this.read(id);
  }

  @ApiOperation({
    summary: 'Registrar una entrega fallida',
    description:
      'Desde `DISPATCHED`. La orden sigue en `SHIPPED`, sin reintento, cancelación ni reembolso (ADR-0053). Se audita como `shipments.delivery-failure`, con la nota como motivo.',
  })
  @ApiOkResponse({ type: AdminShipmentDto })
  @ApiProblemResponses(
    'not-found',
    'version-conflict',
    'invalid-state-transition',
  )
  @RequirePermissions('shipping.manage')
  @HttpCode(200)
  @Post(':shipmentId/delivery-failure')
  async failDelivery(
    @Param('shipmentId') shipmentId: string,
    @Body() body: ShipmentNoteDto,
  ): Promise<AdminShipmentDto> {
    const id = shipmentIdOf(shipmentId);
    await this.delivery.failDelivery({
      shipmentId: id,
      note: noteOf(body),
      version: body.version,
    });
    return this.read(id);
  }

  @ApiOperation({
    summary: 'Marcar un envío como devuelto',
    description:
      'Desde `DELIVERY_FAILED`; es definitivo. El stock que regresa se reintegra con `POST /v1/admin/orders/{orderId}/restocks` (ADR-0053). Se audita como `shipments.return`, con la nota como motivo.',
  })
  @ApiOkResponse({ type: AdminShipmentDto })
  @ApiProblemResponses(
    'not-found',
    'version-conflict',
    'invalid-state-transition',
  )
  @RequirePermissions('shipping.manage')
  @HttpCode(200)
  @Post(':shipmentId/return')
  async markReturned(
    @Param('shipmentId') shipmentId: string,
    @Body() body: ShipmentNoteDto,
  ): Promise<AdminShipmentDto> {
    const id = shipmentIdOf(shipmentId);
    await this.delivery.markReturned({
      shipmentId: id,
      note: noteOf(body),
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

/**
 * The carrier and tracking number of the body, trimmed, or `null` for both (ADR-0141).
 *
 * @throws ProblemException `validation-error` on the one that is `null` while the other is not.
 */
function trackingOf(body: RecordTrackingDto): Tracking {
  const { carrierName, trackingNumber } = body;
  if (carrierName === null && trackingNumber === null) {
    return { carrierName: null, trackingNumber: null };
  }
  if (carrierName === null || trackingNumber === null) {
    throw new ProblemException('validation-error', {
      errors: [
        {
          field: carrierName === null ? 'carrierName' : 'trackingNumber',
          code: 'trackingPair',
          message:
            'La paquetería y la guía van juntas: las dos con valor, o las dos en `null` para quitarlas.',
        },
      ],
    });
  }
  return {
    carrierName: carrierName.trim(),
    trackingNumber: trackingNumber.trim(),
  };
}

/** The note of the body, trimmed; `null` when there is none. */
function noteOf(body: ShipmentNoteDto): string | null {
  const note = body.note?.trim() ?? '';
  return note === '' ? null : note;
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
    failureNote: view.failureNote,
    returnNote: view.returnNote,
    version: view.version,
    createdAt: view.createdAt,
  };
}
