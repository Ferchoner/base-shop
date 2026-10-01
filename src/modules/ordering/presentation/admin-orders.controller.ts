import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../../../platform/auth/authenticated-user.js';
import { RequirePermissions } from '../../../platform/auth/authorization.decorators.js';
import { CurrentUser } from '../../../platform/auth/current-user.decorator.js';
import {
  rangeEnd,
  toPageResponse,
  toSortOrders,
} from '../../../platform/http/pagination/pagination.js';
import { pathId } from '../../../platform/http/path-id.js';
import { ApiProblemResponses } from '../../../platform/http/problem-details/api-problem-responses.decorator.js';
import { ProblemException } from '../../../platform/http/problem-details/problem.exception.js';
import { NotFoundError, toId } from '../../../shared-kernel/index.js';
import { OrderLifecycle } from '../application/order-lifecycle.use-case.js';
import {
  OrderingQueries,
  type OrderSortField,
} from '../application/ordering.queries.js';
import {
  AdminOrderDto,
  AdminOrderListDto,
  AdminOrderListQueryDto,
  CancelOrderDto,
  RetryFulfillmentDto,
} from './admin-order.dto.js';
import { toAdminOrderDto, toAdminOrderSummaryDto } from './ordering.mappers.js';

const orderIdOf = (id: string) => pathId<'Order'>(id, 'Order');

/**
 * Orders for the staff (UC-ORD-06 to 08, API_SPEC.md §15.7). Changes send the `version` read and lock the
 * order, so a staff action and a payment never change it at the same time (ADR-0133).
 */
@ApiTags('Administración: pedidos')
@ApiProblemResponses('unauthenticated', 'forbidden', 'password-change-required')
@Controller('admin/orders')
export class AdminOrdersController {
  constructor(
    private readonly queries: OrderingQueries,
    private readonly lifecycle: OrderLifecycle,
  ) {}

  @ApiOperation({
    summary: 'Listar pedidos',
    description:
      'Sin líneas ni historial. `payment` y `shipment` son `null` hasta T-190 y T-195.',
  })
  @ApiOkResponse({ type: AdminOrderListDto })
  @RequirePermissions('orders.read')
  @Get()
  async list(
    @Query() query: AdminOrderListQueryDto,
  ): Promise<AdminOrderListDto> {
    const page = await this.queries.listOrders(
      {
        q: query.q,
        status: query.status,
        customerId:
          query.customerId === undefined
            ? undefined
            : toId<'User'>(query.customerId),
        guest: query.guest,
        placedFrom:
          query.placedFrom === undefined
            ? undefined
            : new Date(query.placedFrom),
        placedTo: rangeEnd(query.placedTo),
        hasPendingRefund: query.hasPendingRefund,
      },
      toSortOrders<OrderSortField>(query.sort, '-placedAt'),
      query,
    );
    return toPageResponse(page, query, toAdminOrderSummaryDto);
  }

  @ApiOperation({ summary: 'Consultar un pedido, con su historial' })
  @ApiOkResponse({ type: AdminOrderDto })
  @ApiProblemResponses('not-found')
  @RequirePermissions('orders.read')
  @Get(':orderId')
  get(@Param('orderId') orderId: string): Promise<AdminOrderDto> {
    return this.read(orderIdOf(orderId));
  }

  @ApiOperation({
    summary: 'Cancelar un pedido',
    description:
      'Desde `PENDING_PAYMENT`: pasa a `CANCELLED` y libera su reserva. Las órdenes pagadas se cancelan, con su reembolso, desde T-190 (ADR-0133). `restock` necesita además `inventory.write` y solo aplica a `PAID`.',
  })
  @ApiOkResponse({ type: AdminOrderDto })
  @ApiProblemResponses(
    'not-found',
    'version-conflict',
    'invalid-state-transition',
    'restock-not-allowed',
  )
  @RequirePermissions('orders.manage')
  @HttpCode(200)
  @Post(':orderId/cancel')
  async cancel(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('orderId') orderId: string,
    @Body() body: CancelOrderDto,
  ): Promise<AdminOrderDto> {
    const id = orderIdOf(orderId);
    const restock = body.restock === true;
    if (restock && !actor.permissions.includes('inventory.write')) {
      throw new ProblemException('forbidden');
    }
    await this.lifecycle.cancel({
      orderId: id,
      actorId: toId<'User'>(actor.id),
      reason: body.reason,
      restock,
      version: body.version,
    });
    return this.read(id);
  }

  @ApiOperation({
    summary: 'Reintentar el surtido de un pedido',
    description:
      'Desde `AWAITING_MANUAL_FULFILLMENT`: reserva y confirma el stock, y el pedido pasa a `PAID` (ADR-0012). Sin stock no cambia nada; si se decide no surtir, se cancela.',
  })
  @ApiOkResponse({ type: AdminOrderDto })
  @ApiProblemResponses(
    'not-found',
    'version-conflict',
    'invalid-state-transition',
    'insufficient-stock',
  )
  @RequirePermissions('orders.manage')
  @HttpCode(200)
  @Post(':orderId/retry-fulfillment')
  async retryFulfillment(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('orderId') orderId: string,
    @Body() body: RetryFulfillmentDto,
  ): Promise<AdminOrderDto> {
    const id = orderIdOf(orderId);
    await this.lifecycle.retryFulfillment({
      orderId: id,
      actorId: toId<'User'>(actor.id),
      version: body.version,
    });
    return this.read(id);
  }

  private async read(id: ReturnType<typeof orderIdOf>): Promise<AdminOrderDto> {
    const order = await this.queries.findAdminOrder(id);
    if (order === null) throw new NotFoundError('Order', id);
    return toAdminOrderDto(order);
  }
}
