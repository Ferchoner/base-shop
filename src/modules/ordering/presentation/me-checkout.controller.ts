import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../../../platform/auth/authenticated-user.js';
import { RequireAccount } from '../../../platform/auth/authorization.decorators.js';
import { CurrentUser } from '../../../platform/auth/current-user.decorator.js';
import { NoStaffPurchases } from '../../../platform/auth/no-staff-purchases.guard.js';
import { ApiProblemResponses } from '../../../platform/http/problem-details/api-problem-responses.decorator.js';
import { toId } from '../../../shared-kernel/index.js';
import { Checkout } from '../application/checkout.use-case.js';
import { QUOTE_DESCRIPTION } from './checkout.controller.js';
import { CheckoutQuoteDto } from './checkout.dto.js';
import { toCheckoutQuoteDto } from './ordering.mappers.js';

/** The quote of the signed-in customer's active cart (UC-ORD-01, API_SPEC.md §15.2). */
@ApiTags('Checkout')
@ApiProblemResponses('unauthenticated', 'staff-cannot-purchase')
@RequireAccount()
@UseGuards(NoStaffPurchases)
@Controller('me/checkout')
export class MeCheckoutController {
  constructor(private readonly checkout: Checkout) {}

  @ApiOperation({
    summary: 'Cotizar mi carrito',
    description: `${QUOTE_DESCRIPTION} Sin carrito activo, 409 \`empty-cart\`.`,
  })
  @ApiOkResponse({ type: CheckoutQuoteDto })
  @ApiProblemResponses('empty-cart')
  @HttpCode(200)
  @Post('quote')
  async quote(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CheckoutQuoteDto> {
    return toCheckoutQuoteDto(
      await this.checkout.quote({ customerId: toId<'User'>(user.id) }),
    );
  }
}
