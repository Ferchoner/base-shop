import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { NoStaffPurchases } from '../../../platform/auth/no-staff-purchases.guard.js';
import { cartScope } from '../../../platform/http/idempotency/idempotency-scope.js';
import { Idempotent } from '../../../platform/http/idempotency/idempotent.decorator.js';
import { ApiProblemResponses } from '../../../platform/http/problem-details/api-problem-responses.decorator.js';
import { RateLimit } from '../../../platform/http/rate-limiting/rate-limit.decorator.js';
import { NotFoundError, toId } from '../../../shared-kernel/index.js';
import { Checkout } from '../application/checkout.use-case.js';
import { OrderAccessLinks } from '../application/order-access-links.js';
import { OrderPaymentRequests } from '../application/order-payment-requests.use-case.js';
import { OrderReader } from '../application/order-reader.js';
import { OrderReorders } from '../application/order-reorders.use-case.js';
import { parsePublicCode } from '../application/order-values.js';
import {
  GuestOrderLookupDto,
  GuestReorderDto,
  OrderAccessDto,
  OrderAccessLinkRequestDto,
  OrderAccessRequestDto,
  OrderDto,
  PlaceGuestOrderDto,
  ReorderDto,
} from './order.dto.js';
import {
  toOrderAccessDto,
  toOrderDto,
  toPaymentStartDto,
  toReorderDto,
} from './ordering.mappers.js';
import { PaymentStartDto, StartGuestPaymentDto } from './payment.dto.js';

/** What placing an order answers on both routes (API_SPEC.md §15.3). */
export const PLACE_ORDER_PROBLEMS = [
  'idempotency-key-missing',
  'idempotency-key-mismatch',
  'idempotency-request-in-progress',
  'rate-limit-exceeded',
  'not-found',
  'cart-not-active',
  'empty-cart',
  'variant-not-sellable',
  'total-mismatch',
  'insufficient-stock',
] as const;

/** What starting a payment answers on both routes (API_SPEC.md §16.2). */
export const START_PAYMENT_PROBLEMS = [
  'idempotency-key-missing',
  'idempotency-key-mismatch',
  'idempotency-request-in-progress',
  'not-found',
  'invalid-state-transition',
] as const;

export const START_PAYMENT_DESCRIPTION =
  'Exige `Idempotency-Key`. Solo órdenes en `PENDING_PAYMENT`; el monto es el total de la orden. Con `MANUAL`, la acción indica pagar en la tienda con el código público y el total. Si el pago ya se inició con el mismo proveedor responde 200 con la misma acción; con otro, 409.';

export const REORDER_RULES =
  'Solo órdenes `CANCELLED` o `REFUNDED`; la orden no cambia. Las líneas se suman con tope de 30 por línea, y las variantes que ya no se venden se omiten y se listan en `skippedVariantIds`. Responde el carrito que las recibió: se lee con las rutas del carrito, con precios y disponibilidad actuales.';

export const PLACE_ORDER_DESCRIPTION =
  'Exige `Idempotency-Key`. Recalcula todo sin cache; si el total difiere de `expectedTotal` responde 409 `total-mismatch` con `currentTotal` y no crea la orden. Reserva todo el stock o nada, crea la orden en `PENDING_PAYMENT` y deja el carrito `CHECKED_OUT`, en una sola transacción. Hasta 10 órdenes por usuario o carrito cada 10 minutos.';

/**
 * The order of a guest (UC-ORD-02, 04 and 05, API_SPEC.md §15.3, §15.5 and §15.6). A staff account cannot place it
 * nor pay it (403, E-09), but can look it up and use an access link, as it can read a guest cart (ADR-0138).
 */
@ApiTags('Pedidos')
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly checkout: Checkout,
    private readonly reader: OrderReader,
    private readonly paymentRequests: OrderPaymentRequests,
    private readonly reorders: OrderReorders,
    private readonly accessLinks: OrderAccessLinks,
  ) {}

  @ApiOperation({
    summary: 'Colocar la orden de un invitado',
    description: `${PLACE_ORDER_DESCRIPTION} El invitado consulta su pedido con el email de contacto y el código público.`,
  })
  @ApiCreatedResponse({ type: OrderDto })
  @ApiProblemResponses('staff-cannot-purchase', ...PLACE_ORDER_PROBLEMS)
  @UseGuards(NoStaffPurchases)
  @RateLimit('place-order')
  @Idempotent(cartScope)
  @Post()
  async place(@Body() body: PlaceGuestOrderDto): Promise<OrderDto> {
    const id = await this.checkout.placeOrder({
      guestCartId: toId<'Cart'>(body.cartId),
      contactEmail: body.contactEmail,
      shippingAddress: {
        ...body.shippingAddress,
        interiorNumber: body.shippingAddress.interiorNumber ?? null,
        city: body.shippingAddress.city ?? null,
        references: body.shippingAddress.references ?? null,
      },
      privacyNoticeVersion: body.privacyNoticeVersion,
      expectedTotal: body.expectedTotal,
    });
    const order = await this.reader.order(id);
    // The transaction that created it already committed.
    if (order === null) throw new Error(`Order ${id} was not saved`);
    return toOrderDto(order);
  }

  @ApiOperation({
    summary: 'Iniciar el pago de la orden de un invitado',
    description: `${START_PAYMENT_DESCRIPTION} El \`cartId\` debe ser el carrito de origen de la orden.`,
  })
  @ApiCreatedResponse({ type: PaymentStartDto })
  @ApiOkResponse({ type: PaymentStartDto })
  @ApiProblemResponses('staff-cannot-purchase', ...START_PAYMENT_PROBLEMS)
  @UseGuards(NoStaffPurchases)
  @Idempotent(cartScope)
  @Post(':publicCode/payments')
  async startPayment(
    @Param('publicCode') publicCode: string,
    @Body() body: StartGuestPaymentDto,
    @Res({ passthrough: true }) response: { status(code: number): unknown },
  ): Promise<PaymentStartDto> {
    const code = parsePublicCode(publicCode);
    if (code === null) throw new NotFoundError('Order', publicCode);
    const start = await this.paymentRequests.startPayment({
      publicCode: code,
      payer: { guestCartId: toId<'Cart'>(body.cartId) },
      provider: body.provider,
    });
    if (!start.started) response.status(200);
    return toPaymentStartDto(start);
  }

  @ApiOperation({
    summary: 'Consultar el pedido de un invitado',
    description:
      'Con el email de contacto y el código público, en el cuerpo para que no queden en logs (ADR-0071). Solo órdenes de invitado: una de cliente se consulta en `/v1/me/orders`. Responde el mismo 404 si la orden no existe, el email no coincide, el código no puede existir o la orden es de una cuenta (BR-ORD-11). Hasta 10 consultas por IP cada 15 minutos, compartidas con la recompra de invitado y el enlace de acceso.',
  })
  @ApiOkResponse({ type: OrderDto })
  @ApiProblemResponses('not-found', 'rate-limit-exceeded')
  @RateLimit('guest-order')
  @HttpCode(200)
  @Post('lookup')
  async lookup(@Body() body: GuestOrderLookupDto): Promise<OrderDto> {
    const code = parsePublicCode(body.publicCode);
    const order =
      code === null
        ? null
        : await this.reader.guestOrder(code, body.contactEmail);
    // The same answer for every miss, without the email nor the code, also in the log (BR-ORD-11, ADR-0071).
    if (order === null) {
      throw new NotFoundError('Guest order', 'with that email and code');
    }
    return toOrderDto(order);
  }

  @ApiOperation({
    summary: 'Pedir un enlace a los pedidos de invitado',
    description:
      'Con el email de contacto solo, para quien perdió el código de su pedido. Responde 202 sin cuerpo en cuanto recibe la solicitud: el enlace se emite y se envía después, solo si el email tiene órdenes de invitado, así que ni la respuesta ni su tiempo dicen si las tiene. El enlace nuevo invalida los anteriores. Límite: 3 por email y 10 por IP por hora.',
  })
  @ApiAcceptedResponse()
  @ApiProblemResponses('rate-limit-exceeded')
  @RateLimit('order-access-email', 'order-access-ip')
  @HttpCode(202)
  @Post('access-links')
  requestAccessLink(@Body() body: OrderAccessLinkRequestDto): void {
    this.accessLinks.request(body.contactEmail);
  }

  @ApiOperation({
    summary: 'Abrir el enlace a los pedidos de invitado',
    description:
      'Con el token del enlace, que sirve una sola vez, dentro de su vigencia y mientras no se pida otro. Responde las 50 órdenes de invitado más recientes del email, sin líneas ni dirección; el detalle de cada una se consulta con el email y su código en `POST /v1/orders/lookup`. Comparte con la consulta 10 por IP cada 15 minutos.',
  })
  @ApiOkResponse({ type: OrderAccessDto })
  @ApiProblemResponses('invalid-or-expired-token', 'rate-limit-exceeded')
  @RateLimit('guest-order')
  @HttpCode(200)
  @Post('access')
  async access(@Body() body: OrderAccessRequestDto): Promise<OrderAccessDto> {
    return toOrderAccessDto(await this.accessLinks.redeem(body.token));
  }

  @ApiOperation({
    summary: 'Volver a comprar la orden de un invitado',
    description: `Con el email de contacto y el código público, como la consulta: el mismo 404 si no coinciden. Copia las líneas al carrito de invitado activo \`cartId\` o, sin él, a uno nuevo. ${REORDER_RULES} Comparte con la consulta 10 por IP cada 15 minutos.`,
  })
  @ApiOkResponse({ type: ReorderDto })
  @ApiProblemResponses(
    'staff-cannot-purchase',
    'not-found',
    'invalid-state-transition',
    'cart-not-active',
    'rate-limit-exceeded',
  )
  @UseGuards(NoStaffPurchases)
  @RateLimit('guest-order')
  @HttpCode(200)
  @Post('reorder')
  async reorder(@Body() body: GuestReorderDto): Promise<ReorderDto> {
    const code = parsePublicCode(body.publicCode);
    if (code === null) {
      throw new NotFoundError('Guest order', 'with that email and code');
    }
    return toReorderDto(
      await this.reorders.forGuest({
        publicCode: code,
        contactEmail: body.contactEmail,
        cartId: body.cartId === undefined ? null : toId<'Cart'>(body.cartId),
      }),
    );
  }
}
