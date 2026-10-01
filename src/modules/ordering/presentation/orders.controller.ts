import { Body, Controller, Param, Post, Res, UseGuards } from '@nestjs/common';
import {
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
import { OrderPaymentRequests } from '../application/order-payment-requests.use-case.js';
import { OrderReader } from '../application/order-reader.js';
import { parsePublicCode } from '../application/order-values.js';
import { OrderDto, PlaceGuestOrderDto } from './order.dto.js';
import { toOrderDto, toPaymentStartDto } from './ordering.mappers.js';
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

export const PLACE_ORDER_DESCRIPTION =
  'Exige `Idempotency-Key`. Recalcula todo sin cache; si el total difiere de `expectedTotal` responde 409 `total-mismatch` con `currentTotal` y no crea la orden. Reserva todo el stock o nada, crea la orden en `PENDING_PAYMENT` y deja el carrito `CHECKED_OUT`, en una sola transacción. Hasta 10 órdenes por usuario o carrito cada 10 minutos.';

/** The order of a guest (UC-ORD-02, API_SPEC.md §15.3). A staff account answers 403 (E-09). */
@ApiTags('Pedidos')
@ApiProblemResponses('staff-cannot-purchase')
@UseGuards(NoStaffPurchases)
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly checkout: Checkout,
    private readonly reader: OrderReader,
    private readonly paymentRequests: OrderPaymentRequests,
  ) {}

  @ApiOperation({
    summary: 'Colocar la orden de un invitado',
    description: `${PLACE_ORDER_DESCRIPTION} El invitado consulta su pedido con el email de contacto y el código público.`,
  })
  @ApiCreatedResponse({ type: OrderDto })
  @ApiProblemResponses(...PLACE_ORDER_PROBLEMS)
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
  @ApiProblemResponses(...START_PAYMENT_PROBLEMS)
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
}
