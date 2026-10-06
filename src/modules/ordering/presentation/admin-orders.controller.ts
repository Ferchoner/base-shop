import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
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
import {
  rangeEnd,
  toPageResponse,
  toSortOrders,
} from '../../../platform/http/pagination/pagination.js';
import { pathId } from '../../../platform/http/path-id.js';
import { ApiProblemResponses } from '../../../platform/http/problem-details/api-problem-responses.decorator.js';
import { userScope } from '../../../platform/http/idempotency/idempotency-scope.js';
import { Idempotent } from '../../../platform/http/idempotency/idempotent.decorator.js';
import { ProblemException } from '../../../platform/http/problem-details/problem.exception.js';
import { RateLimit } from '../../../platform/http/rate-limiting/rate-limit.decorator.js';
import { NotFoundError, toId } from '../../../shared-kernel/index.js';
import type { BuyerChoice } from '../application/order-placement.js';
import { BlockedOrderData } from '../application/blocked-order-data.js';
import { OrderLifecycle } from '../application/order-lifecycle.use-case.js';
import { OrderPaymentRequests } from '../application/order-payment-requests.use-case.js';
import { OrderReader } from '../application/order-reader.js';
import { OrderReorders } from '../application/order-reorders.use-case.js';
import { OrderRestocks } from '../application/order-restocks.use-case.js';
import { type OrderSortField } from '../application/ordering.queries.js';
import { StaffCheckout } from '../application/staff-checkout.use-case.js';
import {
  AdminOrderDto,
  AdminOrderListDto,
  AdminOrderListQueryDto,
  BlockedOrderDataDto,
  BlockedOrderDataRequestDto,
  CancelOrderDto,
  PlaceStaffOrderDto,
  RestockDto,
  RestockOrderDto,
  RetryFulfillmentDto,
  StaffQuoteDto,
} from './admin-order.dto.js';
import { CheckoutQuoteDto } from './checkout.dto.js';
import { QUOTE_DESCRIPTION } from './checkout.controller.js';
import { shippingAddressOf } from './me-orders.controller.js';
import { ReorderDto } from './order.dto.js';
import { PLACE_ORDER_PROBLEMS, REORDER_RULES } from './orders.controller.js';
import { ManualCaptureDto } from './payment.dto.js';
import {
  toAdminOrderDto,
  toAdminOrderSummaryDto,
  toBlockedOrderDataDto,
  toCheckoutQuoteDto,
  toReorderDto,
} from './ordering.mappers.js';

const orderIdOf = (id: string) => pathId<'Order'>(id, 'Order');

/**
 * Orders for the staff (UC-ORD-06 to 08, 12 and 13, API_SPEC.md §15.7). Changes send the `version` read and lock the
 * order, so a staff action and a payment never change it at the same time (ADR-0133). In the physical store, the
 * staff quotes and places orders on behalf of a customer (ADR-0161).
 */
@ApiTags('Administración: pedidos')
@ApiProblemResponses('unauthenticated', 'forbidden', 'password-change-required')
@Controller('admin/orders')
export class AdminOrdersController {
  constructor(
    private readonly reader: OrderReader,
    private readonly lifecycle: OrderLifecycle,
    private readonly paymentRequests: OrderPaymentRequests,
    private readonly reorders: OrderReorders,
    private readonly restocks: OrderRestocks,
    private readonly blockedData: BlockedOrderData,
    private readonly staffCheckout: StaffCheckout,
  ) {}

  @ApiOperation({
    summary: 'Cotizar un pedido en la tienda física',
    description: `UC-ORD-12 (ADR-0161). ${QUOTE_DESCRIPTION} Las líneas vienen en la solicitud, sin carrito, y la disponibilidad es la del almacén \`warehouseId\`. Si el almacén no existe o está inactivo, o una variante no existe, 404.`,
  })
  @ApiOkResponse({ type: CheckoutQuoteDto })
  @ApiProblemResponses('not-found')
  @RequirePermissions('orders.place')
  @HttpCode(200)
  @Post('quote')
  async quote(@Body() body: StaffQuoteDto): Promise<CheckoutQuoteDto> {
    return toCheckoutQuoteDto(
      await this.staffCheckout.quote({
        lines: linesOf(body),
        warehouseId: toId<'Warehouse'>(body.warehouseId),
      }),
    );
  }

  @ApiOperation({
    summary: 'Colocar un pedido en la tienda física a nombre de un cliente',
    description: `UC-ORD-13 (ADR-0161). Exige \`Idempotency-Key\`. Para un cliente registrado y activo, con el email verificado, cuyo contacto es el email de su cuenta; o para un invitado, con \`contactEmail\` y la versión del aviso de privacidad que el staff le presentó. Exactamente uno de \`customerId\` y \`contactEmail\`, y uno de \`addressId\` y \`shippingAddress\`; \`addressId\` solo con \`customerId\`. Recalcula todo sin cache; si el total difiere de \`expectedTotal\` responde 409 \`total-mismatch\` con \`currentTotal\`. Reserva todo el stock en el almacén \`warehouseId\` o nada, y crea la orden \`STORE\` en \`PENDING_PAYMENT\`, en una sola transacción; sin carrito, una orden vencida no regresa a ninguno. Si el almacén no existe o está inactivo, 404. Hasta 30 órdenes por cuenta de staff cada 10 minutos. Se audita como \`orders.place\`.`,
  })
  @ApiCreatedResponse({ type: AdminOrderDto })
  @ApiProblemResponses(
    ...PLACE_ORDER_PROBLEMS.filter(
      (code) => code !== 'cart-not-active' && code !== 'empty-cart',
    ),
    'email-not-verified',
  )
  @RequirePermissions('orders.place')
  @RateLimit('admin-place-order')
  @Idempotent(userScope)
  @Post()
  async place(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: PlaceStaffOrderDto,
    @Res({ passthrough: true })
    response: { setHeader(name: string, value: string): void },
  ): Promise<AdminOrderDto> {
    const buyer = buyerOf(body);
    const shippingAddress = shippingAddressOf(body);
    if ('addressId' in shippingAddress && !('customerId' in buyer)) {
      throw fieldProblem(
        'addressId',
        'onlyWithCustomer',
        'Solo con `customerId`: un invitado escribe su dirección en `shippingAddress`.',
      );
    }
    const id = await this.staffCheckout.place({
      staffId: toId<'User'>(actor.id),
      warehouseId: toId<'Warehouse'>(body.warehouseId),
      lines: linesOf(body),
      buyer,
      shippingAddress,
      expectedTotal: body.expectedTotal,
    });
    response.setHeader('Location', `/v1/admin/orders/${id}`);
    return this.read(id);
  }

  @ApiOperation({
    summary: 'Volver a comprar un pedido para su comprador',
    description: `La orden de un cliente va a su carrito activo, o a uno nuevo. La de un invitado, a su carrito original: si sigue \`CHECKED_OUT\` vuelve a \`ACTIVE\` solo con las líneas que se siguen vendiendo; si ya no existe o pasó a una cuenta, 409 \`source-cart-unavailable\` y no se crea otro (ADR-0082). ${REORDER_RULES} Se audita como \`orders.reorder\`.`,
  })
  @ApiOkResponse({ type: ReorderDto })
  @ApiProblemResponses(
    'not-found',
    'invalid-state-transition',
    'source-cart-unavailable',
  )
  @RequirePermissions('orders.manage')
  @HttpCode(200)
  @Post(':orderId/reorder')
  async reorder(@Param('orderId') orderId: string): Promise<ReorderDto> {
    return toReorderDto(await this.reorders.forStaff(orderIdOf(orderId)));
  }

  @ApiOperation({
    summary: 'Listar pedidos',
    description:
      'Sin líneas ni historial, con el pago y el envío de cada pedido; `payment` o `shipment` es `null` si el pedido aún no lo tiene.',
  })
  @ApiOkResponse({ type: AdminOrderListDto })
  @RequirePermissions('orders.read')
  @Get()
  async list(
    @Query() query: AdminOrderListQueryDto,
  ): Promise<AdminOrderListDto> {
    const page = await this.reader.orders(
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
        channel: query.channel,
        placedBy:
          query.placedBy === undefined
            ? undefined
            : toId<'User'>(query.placedBy),
      },
      toSortOrders<OrderSortField>(query.sort, '-placedAt'),
      query,
    );
    return toPageResponse(page, query, toAdminOrderSummaryDto);
  }

  @ApiOperation({
    summary: 'Consultar un pedido, con su historial',
    description:
      'La vista del staff: líneas, totales, dirección, pago con sus reembolsos, envío e historial de estados. Una orden bloqueada no muestra su email ni su dirección exacta, que se consultan con `POST …/blocked-data` (ADR-0070).',
  })
  @ApiOkResponse({ type: AdminOrderDto })
  @ApiProblemResponses('not-found')
  @RequirePermissions('orders.read')
  @Get(':orderId')
  get(@Param('orderId') orderId: string): Promise<AdminOrderDto> {
    return this.read(orderIdOf(orderId));
  }

  @ApiOperation({
    summary: 'Consultar los datos personales bloqueados de un pedido',
    description:
      'Para atender una reclamación o un requerimiento (ADR-0070, ADR-0152): el email de contacto, la dirección y el destino de su envío, como se guardaron. Solo en un pedido bloqueado (`blockedAt`); en uno que no lo está, cuyos datos ya se ven, o en uno anonimizado, que ya no los tiene, 409 `invalid-state-transition`. Se audita como `orders.read-blocked-data` con el motivo y sin los datos; si la auditoría falla, no se devuelve nada.',
  })
  @ApiOkResponse({ type: BlockedOrderDataDto })
  @ApiProblemResponses('not-found', 'invalid-state-transition')
  @RequirePermissions('orders.read-blocked')
  @HttpCode(200)
  @Post(':orderId/blocked-data')
  async readBlockedData(
    @Param('orderId') orderId: string,
    @Body() body: BlockedOrderDataRequestDto,
  ): Promise<BlockedOrderDataDto> {
    return toBlockedOrderDataDto(
      await this.blockedData.read({
        orderId: orderIdOf(orderId),
        reason: body.reason,
      }),
    );
  }

  @ApiOperation({
    summary: 'Cancelar un pedido',
    description:
      'Desde `PENDING_PAYMENT`: pasa a `CANCELLED`, libera su reserva y cancela su pago pendiente. Desde `PAID` o `AWAITING_MANUAL_FULFILLMENT`: pasa a `CANCELLED` e inicia el reembolso total en la misma operación; pasa a `REFUNDED` cuando el reembolso se completa (ADR-0051, ADR-0135). `restock`, solo en `PAID` y con `inventory.write`, reintegra todas las líneas completas en la misma operación, auditado como `orders.restock` (ADR-0142).',
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
    summary: 'Reintegrar el stock de un pedido',
    description:
      'UC-INV-09 (ADR-0052, ADR-0142). Exige `Idempotency-Key`. `ORDER_CANCELLED` para un pedido `CANCELLED` o `REFUNDED`, y `SHIPMENT_RETURNED` para uno con el envío `RETURNED`; si no, 409 `invalid-state-transition`. Cada línea regresa a lo sumo lo que vendió, sumando los reintegros anteriores; lo vendido cuenta solo si el stock del pedido se confirmó. Si no, 409 `restock-not-allowed` con `lines`, y no se reintegra nada. Las unidades regresan al almacén del que salieron, aunque esté inactivo, o al almacén activo `warehouseId`; otro valor, 404 (ADR-0160). El pedido no cambia. Se audita como `orders.restock`.',
  })
  @ApiCreatedResponse({ type: RestockDto })
  @ApiProblemResponses(
    'not-found',
    'invalid-state-transition',
    'restock-not-allowed',
  )
  @RequirePermissions('inventory.write')
  @Idempotent(userScope)
  @Post(':orderId/restocks')
  async restock(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('orderId') orderId: string,
    @Body() body: RestockOrderDto,
  ): Promise<RestockDto> {
    const note = body.note?.trim() ?? '';
    const movements = await this.restocks.restock({
      orderId: orderIdOf(orderId),
      reasonCode: body.reasonCode,
      lines: body.lines.map((line) => ({
        orderLineId: toId<'OrderLine'>(line.orderLineId),
        quantity: line.quantity,
      })),
      note: note === '' ? null : note,
      actorId: toId<'User'>(actor.id),
      warehouseId:
        body.warehouseId === undefined
          ? null
          : toId<'Warehouse'>(body.warehouseId),
    });
    return { movements: movements.map((movement) => ({ ...movement })) };
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

  @ApiOperation({
    summary: 'Registrar el pago en tienda de un pedido',
    description:
      'Solo con el pago manual habilitado y desde `PENDING_PAYMENT` o `EXPIRED` (ADR-0055). Registra el cobro por el total del pedido, con el comprobante y cómo se cobró (`method`, ADR-0161), y responde el pedido con su pago capturado; el pedido pasa a `PAID`, o sigue el flujo de pago tardío, en segundo plano (API_SPEC.md §2.5).',
  })
  @ApiOkResponse({ type: AdminOrderDto })
  @ApiProblemResponses(
    'manual-payments-disabled',
    'not-found',
    'invalid-state-transition',
  )
  @RequirePermissions('payments.manage')
  @HttpCode(200)
  @Post(':orderId/manual-capture')
  async captureManually(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('orderId') orderId: string,
    @Body() body: ManualCaptureDto,
  ): Promise<AdminOrderDto> {
    const id = orderIdOf(orderId);
    const note = body.note?.trim() ?? '';
    await this.paymentRequests.captureManually({
      orderId: id,
      staffId: toId<'User'>(actor.id),
      reference: body.reference.trim(),
      method: body.method ?? null,
      note: note === '' ? null : note,
    });
    return this.read(id);
  }

  private async read(id: ReturnType<typeof orderIdOf>): Promise<AdminOrderDto> {
    const order = await this.reader.adminOrder(id);
    if (order === null) throw new NotFoundError('Order', id);
    return toAdminOrderDto(order);
  }
}

/** The lines of a staff order, as the use case takes them. */
function linesOf(body: StaffQuoteDto) {
  return body.lines.map(({ variantId, quantity }) => ({
    variantId: toId<'Variant'>(variantId),
    quantity,
  }));
}

/**
 * Who the staff order is for: a customer, or a guest with the version of the privacy notice the staff presented,
 * exactly one of them (API_SPEC.md §15.7).
 *
 * @throws ProblemException `validation-error` on `customerId` with both or neither, or on `privacyNoticeVersion`
 *   when a guest lacks it or a customer sends it.
 */
function buyerOf(body: PlaceStaffOrderDto): BuyerChoice {
  if ((body.customerId === undefined) === (body.contactEmail === undefined)) {
    throw fieldProblem(
      'customerId',
      'exactlyOneBuyer',
      'Envía `customerId` o `contactEmail`, solo uno de los dos.',
    );
  }
  if (body.customerId !== undefined) {
    if (body.privacyNoticeVersion !== undefined) {
      throw fieldProblem(
        'privacyNoticeVersion',
        'onlyForGuest',
        'Solo con `contactEmail`: un cliente registrado aceptó el aviso al crear su cuenta.',
      );
    }
    return { customerId: toId<'User'>(body.customerId) };
  }
  if (body.privacyNoticeVersion === undefined) {
    throw fieldProblem('privacyNoticeVersion', 'isDefined', 'Es obligatorio.');
  }
  return {
    contactEmail: body.contactEmail!,
    privacyNoticeVersion: body.privacyNoticeVersion,
  };
}

function fieldProblem(
  field: string,
  code: string,
  message: string,
): ProblemException {
  return new ProblemException('validation-error', {
    errors: [{ field, code, message }],
  });
}
