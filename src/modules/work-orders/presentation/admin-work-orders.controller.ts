import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../../../platform/auth/authenticated-user.js';
import { RequirePermissions } from '../../../platform/auth/authorization.decorators.js';
import { CurrentUser } from '../../../platform/auth/current-user.decorator.js';
import { userScope } from '../../../platform/http/idempotency/idempotency-scope.js';
import { Idempotent } from '../../../platform/http/idempotency/idempotent.decorator.js';
import {
  rangeEnd,
  toPageResponse,
  toSortOrders,
} from '../../../platform/http/pagination/pagination.js';
import { pathId } from '../../../platform/http/path-id.js';
import { ApiProblemResponses } from '../../../platform/http/problem-details/api-problem-responses.decorator.js';
import {
  type Id,
  Money,
  NotFoundError,
  toId,
} from '../../../shared-kernel/index.js';
import { ReceiveWorkOrder } from '../application/receive-work-order.use-case.js';
import { UpdateWorkOrder } from '../application/update-work-order.use-case.js';
import { WorkOrderLifecycle } from '../application/work-order-lifecycle.use-case.js';
import { WorkOrderReader } from '../application/work-order-reader.js';
import { WorkOrderSales } from '../application/work-order-sales.use-case.js';
import {
  WorkOrderQueries,
  type WorkOrderSortField,
} from '../application/work-orders.queries.js';
import {
  ChangeWorkOrderStatusDto,
  LinkSaleDto,
  ReceiveWorkOrderDto,
  ServiceNoteDto,
  UnlinkSaleQueryDto,
  UpdateWorkOrderDto,
  WorkOrderDto,
  WorkOrderListDto,
  WorkOrderListQueryDto,
} from './work-order.dto.js';
import {
  toServiceNoteDto,
  toWorkOrderDto,
  toWorkOrderSummaryDto,
} from './work-order.mappers.js';

const workOrderIdOf = (id: string) => pathId<'WorkOrder'>(id, 'WorkOrder');

const saleIdOf = (id: string) => pathId<'Order'>(id, 'Sale');

const userIdOf = (id: string | null | undefined): Id<'User'> | null =>
  id === undefined || id === null ? null : toId<'User'>(id);

const costOf = (amount: number | null | undefined): Money | null =>
  amount === undefined || amount === null ? null : Money.of(amount, 'MXN');

/** `undefined` stays: the field keeps its value. */
const changed = <Value, Result>(
  value: Value | undefined,
  map: (value: Value) => Result,
): Result | undefined => (value === undefined ? undefined : map(value));

/**
 * Work orders, the service notes of the equipment a customer leaves in the physical store (UC-WRK-01 to 06,
 * API_SPEC.md §25, ADR-0165 to ADR-0167): with the counter sales that pay for them and the data to print their note.
 * Changes send the `version` read (optimistic locking).
 */
@ApiTags('Administración: órdenes de trabajo')
@ApiProblemResponses('unauthenticated', 'forbidden', 'password-change-required')
@Controller('admin/work-orders')
export class AdminWorkOrdersController {
  constructor(
    private readonly queries: WorkOrderQueries,
    private readonly reader: WorkOrderReader,
    private readonly receiveWorkOrder: ReceiveWorkOrder,
    private readonly updateWorkOrder: UpdateWorkOrder,
    private readonly lifecycle: WorkOrderLifecycle,
    private readonly sales: WorkOrderSales,
  ) {}

  @ApiOperation({
    summary: 'Recibir un equipo: crear la orden de trabajo',
    description:
      'UC-WRK-01 (ADR-0166). Exige `Idempotency-Key`, para que un doble envío no imprima dos folios. Nace en `RECEIVED`, con el siguiente folio consecutivo, en la tienda del almacén `warehouseId` y a nombre de quien la recibe. El nombre y el teléfono del cliente son obligatorios, aunque se ligue un cliente registrado con `customerId`. Si el almacén no existe o está inactivo, si `customerId` no es de un cliente activo o si `technicianId` no es de una cuenta de staff activa, 404. Se audita como `work-orders.create`, sin los datos personales.',
  })
  @ApiCreatedResponse({ type: WorkOrderDto })
  @ApiProblemResponses('not-found')
  @RequirePermissions('work-orders.manage')
  @Idempotent(userScope)
  @Post()
  async receive(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: ReceiveWorkOrderDto,
    @Res({ passthrough: true })
    response: { setHeader(name: string, value: string): void },
  ): Promise<WorkOrderDto> {
    const id = await this.receiveWorkOrder.execute({
      staffId: toId<'User'>(actor.id),
      warehouseId: toId<'Warehouse'>(body.warehouseId),
      details: {
        customerId: userIdOf(body.customerId),
        customerName: body.customerName,
        customerPhone: body.customerPhone,
        customerEmail: body.customerEmail ?? null,
        equipmentType: body.equipmentType,
        equipmentBrand: body.equipmentBrand ?? null,
        equipmentModel: body.equipmentModel ?? null,
        serialNumber: body.serialNumber ?? null,
        accessories: body.accessories ?? null,
        equipmentCondition: body.equipmentCondition ?? null,
        reportedFault: body.reportedFault,
        estimatedCost: costOf(body.estimatedCost),
        technicianId: userIdOf(body.technicianId),
      },
    });
    response.setHeader('Location', `/v1/admin/work-orders/${id}`);
    return this.read(id);
  }

  @ApiOperation({
    summary: 'Listar y buscar órdenes de trabajo',
    description:
      'UC-WRK-02. Sin historial ni textos largos. `q` busca el folio exacto, o parte del nombre o del teléfono del cliente, o del número de serie.',
  })
  @ApiOkResponse({ type: WorkOrderListDto })
  @RequirePermissions('work-orders.read')
  @Get()
  async list(@Query() query: WorkOrderListQueryDto): Promise<WorkOrderListDto> {
    const page = await this.queries.listWorkOrders(
      {
        q: query.q,
        status: query.status,
        warehouseId:
          query.warehouseId === undefined
            ? undefined
            : toId<'Warehouse'>(query.warehouseId),
        technicianId: userIdOf(query.technicianId) ?? undefined,
        customerId: userIdOf(query.customerId) ?? undefined,
        receivedFrom:
          query.receivedFrom === undefined
            ? undefined
            : new Date(query.receivedFrom),
        receivedTo: rangeEnd(query.receivedTo),
      },
      toSortOrders<WorkOrderSortField>(query.sort, '-receivedAt'),
      query,
    );
    return toPageResponse(page, query, toWorkOrderSummaryDto);
  }

  @ApiOperation({
    summary: 'Consultar una orden de trabajo, con su historial',
    description: 'UC-WRK-02. Todos sus datos y el historial de estados.',
  })
  @ApiOkResponse({ type: WorkOrderDto })
  @ApiProblemResponses('not-found')
  @RequirePermissions('work-orders.read')
  @Get(':workOrderId')
  get(@Param('workOrderId') workOrderId: string): Promise<WorkOrderDto> {
    return this.read(workOrderIdOf(workOrderId));
  }

  @ApiOperation({
    summary: 'Corregir los datos y registrar el diagnóstico y el trabajo',
    description:
      'UC-WRK-03 (ADR-0166). Solo cambian los campos enviados. Una orden entregada o cancelada ya no se edita: 409 `invalid-state-transition`. Un cliente ligado nuevo debe estar activo, y un técnico nuevo, ser una cuenta de staff activa; si no, 404. Sin cambios, no se guarda ni se audita. Se audita como `work-orders.update`, sin los datos personales.',
  })
  @ApiOkResponse({ type: WorkOrderDto })
  @ApiProblemResponses(
    'not-found',
    'version-conflict',
    'invalid-state-transition',
  )
  @RequirePermissions('work-orders.manage')
  @Patch(':workOrderId')
  async update(
    @Param('workOrderId') workOrderId: string,
    @Body() body: UpdateWorkOrderDto,
  ): Promise<WorkOrderDto> {
    const id = workOrderIdOf(workOrderId);
    await this.updateWorkOrder.execute(
      id,
      {
        customerId: changed(body.customerId, userIdOf),
        customerName: body.customerName,
        customerPhone: body.customerPhone,
        customerEmail: body.customerEmail,
        equipmentType: body.equipmentType,
        equipmentBrand: body.equipmentBrand,
        equipmentModel: body.equipmentModel,
        serialNumber: body.serialNumber,
        accessories: body.accessories,
        equipmentCondition: body.equipmentCondition,
        reportedFault: body.reportedFault,
        diagnosis: body.diagnosis,
        workPerformed: body.workPerformed,
        estimatedCost: changed(body.estimatedCost, costOf),
        technicianId: changed(body.technicianId, userIdOf),
      },
      body.version,
    );
    return this.read(id);
  }

  @ApiOperation({
    summary: 'Cambiar el estado de una orden de trabajo',
    description:
      'UC-WRK-04 (ADR-0166). Hacia adelante, aunque salte pasos (`RECEIVED` → `DIAGNOSED` → `IN_REPAIR` → `READY` → `DELIVERED`), o a `CANCELLED` con `note`, antes de `DELIVERED`. Nunca regresa: un estado que no está adelante, o una orden entregada o cancelada, responde 409 `invalid-state-transition`. Entregar no exige pago (ADR-0165). El historial guarda quién, cuándo y la nota. Se audita como `work-orders.status`, con la nota como motivo.',
  })
  @ApiOkResponse({ type: WorkOrderDto })
  @ApiProblemResponses(
    'not-found',
    'version-conflict',
    'invalid-state-transition',
  )
  @RequirePermissions('work-orders.manage')
  @HttpCode(200)
  @Post(':workOrderId/status')
  async changeStatus(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('workOrderId') workOrderId: string,
    @Body() body: ChangeWorkOrderStatusDto,
  ): Promise<WorkOrderDto> {
    const id = workOrderIdOf(workOrderId);
    await this.lifecycle.moveTo({
      id,
      status: body.status,
      note: body.note ?? null,
      staffId: toId<'User'>(actor.id),
      version: body.version,
    });
    return this.read(id);
  }

  @ApiOperation({
    summary: 'Ligar una venta de mostrador que cobra la orden de trabajo',
    description:
      'UC-WRK-05 (ADR-0167). Solo una orden colocada en la tienda física (`channel` `STORE`); otra, o una que no existe, 404. Una venta vencida, cancelada o reembolsada no se liga: 409 `sale-not-linkable` con `saleStatus`. Una venta cobra una sola orden de trabajo: si ya está ligada, a esta o a otra, 409 `duplicate-value`. Una orden de trabajo entregada o cancelada ya no liga ventas: 409 `invalid-state-transition`. La orden de trabajo no cobra: la venta tiene su propio pago, y entregar no lo exige. Se audita como `work-orders.sale-link`.',
  })
  @ApiOkResponse({ type: WorkOrderDto })
  @ApiProblemResponses(
    'not-found',
    'version-conflict',
    'invalid-state-transition',
    'sale-not-linkable',
    'duplicate-value',
  )
  @RequirePermissions('work-orders.manage')
  @HttpCode(200)
  @Post(':workOrderId/sales')
  async linkSale(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('workOrderId') workOrderId: string,
    @Body() body: LinkSaleDto,
  ): Promise<WorkOrderDto> {
    const id = workOrderIdOf(workOrderId);
    await this.sales.link({
      id,
      orderId: toId<'Order'>(body.orderId),
      staffId: toId<'User'>(actor.id),
      version: body.version,
    });
    return this.read(id);
  }

  @ApiOperation({
    summary: 'Desligar una venta ligada por error',
    description:
      'UC-WRK-05 (ADR-0167). Con la versión leída de la orden de trabajo en `version`. Una venta que la orden de trabajo no tiene, 404; una orden de trabajo entregada o cancelada, 409 `invalid-state-transition`. Se audita como `work-orders.sale-unlink`.',
  })
  @ApiOkResponse({ type: WorkOrderDto })
  @ApiProblemResponses(
    'not-found',
    'version-conflict',
    'invalid-state-transition',
  )
  @RequirePermissions('work-orders.manage')
  @Delete(':workOrderId/sales/:orderId')
  async unlinkSale(
    @Param('workOrderId') workOrderId: string,
    @Param('orderId') orderId: string,
    @Query() query: UnlinkSaleQueryDto,
  ): Promise<WorkOrderDto> {
    const id = workOrderIdOf(workOrderId);
    await this.sales.unlink({
      id,
      orderId: saleIdOf(orderId),
      version: query.version,
    });
    return this.read(id);
  }

  @ApiOperation({
    summary: 'Consultar los datos para imprimir la nota de servicio',
    description:
      'UC-WRK-06 (ADR-0167). La orden de trabajo con sus ventas, los datos de la tienda, los mismos del ticket (ADR-0163), y las condiciones del servicio de `WORK_ORDER_FOOTER`, vacías hasta que el negocio las defina. La línea de firma la dibuja el frontend; la firma no se guarda.',
  })
  @ApiOkResponse({ type: ServiceNoteDto })
  @ApiProblemResponses('not-found')
  @RequirePermissions('work-orders.read')
  @Get(':workOrderId/service-note')
  async serviceNote(
    @Param('workOrderId') workOrderId: string,
  ): Promise<ServiceNoteDto> {
    const id = workOrderIdOf(workOrderId);
    const note = await this.reader.serviceNote(id);
    if (note === null) throw new NotFoundError('WorkOrder', id);
    return toServiceNoteDto(note);
  }

  private async read(id: Id<'WorkOrder'>): Promise<WorkOrderDto> {
    const view = await this.reader.workOrder(id);
    if (view === null) throw new NotFoundError('WorkOrder', id);
    return toWorkOrderDto(view);
  }
}
