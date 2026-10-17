import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../../../platform/auth/authenticated-user.js';
import { RequireAccount } from '../../../platform/auth/authorization.decorators.js';
import { CurrentUser } from '../../../platform/auth/current-user.decorator.js';
import { NoStaffPurchases } from '../../../platform/auth/no-staff-purchases.guard.js';
import { ApiProblemResponses } from '../../../platform/http/problem-details/api-problem-responses.decorator.js';
import { FailedAttemptLimiter } from '../../../platform/http/rate-limiting/failed-attempt-limiter.js';
import { toId } from '../../../shared-kernel/index.js';
import { Checkout } from '../application/checkout.use-case.js';
import { QUOTE_DESCRIPTION } from './checkout.controller.js';
import { CheckoutQuoteDto, CustomerQuoteDto } from './checkout.dto.js';
import { withCouponAttempts } from './coupon-attempts.js';
import { toCheckoutQuoteDto } from './ordering.mappers.js';

/** The quote of the signed-in customer's active cart (UC-ORD-01, API_SPEC.md §15.2). */
@ApiTags('Checkout')
@ApiProblemResponses('unauthenticated', 'staff-cannot-purchase')
@RequireAccount()
@UseGuards(NoStaffPurchases)
@Controller('me/checkout')
export class MeCheckoutController {
  constructor(
    private readonly checkout: Checkout,
    private readonly couponAttempts: FailedAttemptLimiter,
  ) {}

  @ApiOperation({
    summary: 'Cotizar mi carrito',
    description: `${QUOTE_DESCRIPTION} Sin carrito activo, 409 \`empty-cart\`.`,
  })
  // The body is optional: without a coupon, the quote takes none.
  @ApiBody({ type: CustomerQuoteDto, required: false })
  @ApiOkResponse({ type: CheckoutQuoteDto })
  @ApiProblemResponses(
    'empty-cart',
    'coupon-not-applicable',
    'rate-limit-exceeded',
  )
  @HttpCode(200)
  @Post('quote')
  async quote(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CustomerQuoteDto,
    @Req() request: { ip?: string },
  ): Promise<CheckoutQuoteDto> {
    return toCheckoutQuoteDto(
      await withCouponAttempts(
        this.couponAttempts,
        request,
        body.couponCode,
        () =>
          this.checkout.quote(
            { customerId: toId<'User'>(user.id) },
            body.couponCode ?? null,
          ),
      ),
    );
  }
}
