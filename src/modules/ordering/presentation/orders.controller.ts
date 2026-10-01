import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { NoStaffPurchases } from '../../../platform/auth/no-staff-purchases.guard.js';
import { cartScope } from '../../../platform/http/idempotency/idempotency-scope.js';
import { Idempotent } from '../../../platform/http/idempotency/idempotent.decorator.js';
import { ApiProblemResponses } from '../../../platform/http/problem-details/api-problem-responses.decorator.js';
import { RateLimit } from '../../../platform/http/rate-limiting/rate-limit.decorator.js';
import { toId } from '../../../shared-kernel/index.js';
import { Checkout } from '../application/checkout.use-case.js';
import { OrderingQueries } from '../application/ordering.queries.js';
import { OrderDto, PlaceGuestOrderDto } from './order.dto.js';
import { toOrderDto } from './ordering.mappers.js';

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
    private readonly queries: OrderingQueries,
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
    const order = await this.queries.findOrder(id);
    // The transaction that created it already committed.
    if (order === null) throw new Error(`Order ${id} was not saved`);
    return toOrderDto(order);
  }
}
