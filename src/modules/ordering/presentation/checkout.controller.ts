import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { NoStaffPurchases } from '../../../platform/auth/no-staff-purchases.guard.js';
import { ApiProblemResponses } from '../../../platform/http/problem-details/api-problem-responses.decorator.js';
import { NoStore } from '../../../platform/http/no-store.js';
import { toId } from '../../../shared-kernel/index.js';
import { Checkout } from '../application/checkout.use-case.js';
import { CheckoutQuoteDto, GuestQuoteDto } from './checkout.dto.js';
import { toCheckoutQuoteDto } from './ordering.mappers.js';

export const QUOTE_DESCRIPTION =
  'Sin efectos secundarios y sin cache: precios, IVA, envío y disponibilidad de ahora. Las líneas no vendibles o no surtibles no son un error: se marcan y `readyToPlace` queda en `false`. Los totales suman solo las líneas vendibles.';

/** The quote of a guest cart (UC-ORD-01, API_SPEC.md §15.2). A staff account answers 403 (E-09). */
@ApiTags('Checkout')
@ApiProblemResponses('staff-cannot-purchase')
@UseGuards(NoStaffPurchases)
@NoStore()
@Controller('checkout')
export class CheckoutController {
  constructor(private readonly checkout: Checkout) {}

  @ApiOperation({
    summary: 'Cotizar el carrito de un invitado',
    description: QUOTE_DESCRIPTION,
  })
  @ApiOkResponse({ type: CheckoutQuoteDto })
  @ApiProblemResponses('not-found', 'cart-not-active', 'empty-cart')
  @HttpCode(200)
  @Post('quote')
  async quote(@Body() body: GuestQuoteDto): Promise<CheckoutQuoteDto> {
    return toCheckoutQuoteDto(
      await this.checkout.quote({ guestCartId: toId<'Cart'>(body.cartId) }),
    );
  }
}
