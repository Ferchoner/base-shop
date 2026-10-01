import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../../../platform/auth/authenticated-user.js';
import { RequireAccount } from '../../../platform/auth/authorization.decorators.js';
import { CurrentUser } from '../../../platform/auth/current-user.decorator.js';
import { NoStaffPurchases } from '../../../platform/auth/no-staff-purchases.guard.js';
import { userScope } from '../../../platform/http/idempotency/idempotency-scope.js';
import { Idempotent } from '../../../platform/http/idempotency/idempotent.decorator.js';
import {
  rangeEnd,
  toPageResponse,
  toSortOrders,
} from '../../../platform/http/pagination/pagination.js';
import { ProblemException } from '../../../platform/http/problem-details/problem.exception.js';
import { ApiProblemResponses } from '../../../platform/http/problem-details/api-problem-responses.decorator.js';
import { RateLimit } from '../../../platform/http/rate-limiting/rate-limit.decorator.js';
import { NotFoundError, toId } from '../../../shared-kernel/index.js';
import {
  type AddressInput,
  Checkout,
} from '../application/checkout.use-case.js';
import { OrderPaymentRequests } from '../application/order-payment-requests.use-case.js';
import { OrderReader } from '../application/order-reader.js';
import {
  formatPublicCode,
  parsePublicCode,
} from '../application/order-values.js';
import { type CustomerOrderSortField } from '../application/ordering.queries.js';
import {
  OrderDto,
  OrderListDto,
  OrderListQueryDto,
  PlaceCustomerOrderDto,
} from './order.dto.js';
import {
  toOrderDto,
  toOrderSummaryDto,
  toPaymentStartDto,
} from './ordering.mappers.js';
import {
  PLACE_ORDER_DESCRIPTION,
  PLACE_ORDER_PROBLEMS,
  START_PAYMENT_DESCRIPTION,
  START_PAYMENT_PROBLEMS,
} from './orders.controller.js';
import { PaymentStartDto, StartCustomerPaymentDto } from './payment.dto.js';

const customer = (user: AuthenticatedUser) => toId<'User'>(user.id);

/**
 * The orders of the signed-in customer (UC-ORD-02 and 03, API_SPEC.md §15.3 and §15.4). The customer comes from
 * the token, never from the URL; another customer's order is answered 404 (ADR-0036). Placing an order with a
 * staff account answers 403 `staff-cannot-purchase` (E-09), and reading orders, 403 `forbidden`.
 */
@ApiTags('Cuenta: pedidos')
@ApiProblemResponses('unauthenticated')
@Controller('me/orders')
export class MeOrdersController {
  constructor(
    private readonly checkout: Checkout,
    private readonly reader: OrderReader,
    private readonly paymentRequests: OrderPaymentRequests,
  ) {}

  @ApiOperation({
    summary: 'Colocar mi orden',
    description: `${PLACE_ORDER_DESCRIPTION} Usa el carrito activo del cliente, que necesita el email verificado; el contacto es el email de la cuenta. Exactamente uno de \`addressId\` y \`shippingAddress\`.`,
  })
  @ApiCreatedResponse({ type: OrderDto })
  @ApiProblemResponses(
    ...PLACE_ORDER_PROBLEMS,
    'email-not-verified',
    'staff-cannot-purchase',
  )
  @RequireAccount()
  @UseGuards(NoStaffPurchases)
  @RateLimit('place-order')
  @Idempotent(userScope)
  @Post()
  async place(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: PlaceCustomerOrderDto,
    @Res({ passthrough: true })
    response: { setHeader(name: string, value: string): void },
  ): Promise<OrderDto> {
    const id = await this.checkout.placeOrder({
      customerId: customer(user),
      shippingAddress: shippingAddressOf(body),
      expectedTotal: body.expectedTotal,
    });
    const order = await this.reader.order(id);
    // The transaction that created it already committed.
    if (order === null) throw new Error(`Order ${id} was not saved`);
    response.setHeader(
      'Location',
      `/v1/me/orders/${formatPublicCode(order.publicCode)}`,
    );
    return toOrderDto(order);
  }

  @ApiOperation({
    summary: 'Iniciar el pago de mi orden',
    description: START_PAYMENT_DESCRIPTION,
  })
  @ApiCreatedResponse({ type: PaymentStartDto })
  @ApiOkResponse({ type: PaymentStartDto })
  @ApiProblemResponses(...START_PAYMENT_PROBLEMS, 'staff-cannot-purchase')
  @RequireAccount()
  @UseGuards(NoStaffPurchases)
  @Idempotent(userScope)
  @Post(':publicCode/payments')
  async startPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('publicCode') publicCode: string,
    @Body() body: StartCustomerPaymentDto,
    @Res({ passthrough: true }) response: { status(code: number): unknown },
  ): Promise<PaymentStartDto> {
    const code = parsePublicCode(publicCode);
    if (code === null) throw new NotFoundError('Order', publicCode);
    const start = await this.paymentRequests.startPayment({
      publicCode: code,
      payer: { customerId: customer(user) },
      provider: body.provider,
    });
    if (!start.started) response.status(200);
    return toPaymentStartDto(start);
  }

  @ApiOperation({
    summary: 'Listar mis pedidos',
    description: 'Sin líneas ni dirección; con `itemCount`.',
  })
  @ApiOkResponse({ type: OrderListDto })
  @ApiProblemResponses('forbidden')
  @RequireAccount({ customerOnly: true })
  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: OrderListQueryDto,
  ): Promise<OrderListDto> {
    const page = await this.reader.customerOrders(
      customer(user),
      {
        status: query.status,
        placedFrom:
          query.placedFrom === undefined
            ? undefined
            : new Date(query.placedFrom),
        placedTo: rangeEnd(query.placedTo),
      },
      toSortOrders<CustomerOrderSortField>(query.sort, '-placedAt'),
      query,
    );
    return toPageResponse(page, query, toOrderSummaryDto);
  }

  @ApiOperation({
    summary: 'Consultar uno de mis pedidos',
    description:
      'Por su código público, con o sin guion y sin distinguir mayúsculas.',
  })
  @ApiOkResponse({ type: OrderDto })
  @ApiProblemResponses('forbidden', 'not-found')
  @RequireAccount({ customerOnly: true })
  @Get(':publicCode')
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('publicCode') publicCode: string,
  ): Promise<OrderDto> {
    const code = parsePublicCode(publicCode);
    const order =
      code === null
        ? null
        : await this.reader.customerOrder(customer(user), code);
    if (order === null) throw new NotFoundError('Order', publicCode);
    return toOrderDto(order);
  }
}

/**
 * The address of the order: a saved one or one written for it, exactly one of them (API_SPEC.md §15.3).
 *
 * @throws ProblemException `validation-error` on `addressId` with both or neither.
 */
function shippingAddressOf(
  body: PlaceCustomerOrderDto,
): { addressId: string } | AddressInput {
  if ((body.addressId === undefined) === (body.shippingAddress === undefined)) {
    throw new ProblemException('validation-error', {
      errors: [
        {
          field: 'addressId',
          code: 'exactlyOneAddress',
          message:
            'Envía `addressId` o `shippingAddress`, solo uno de los dos.',
        },
      ],
    });
  }
  if (body.addressId !== undefined) return { addressId: body.addressId };
  const address = body.shippingAddress!;
  return {
    ...address,
    interiorNumber: address.interiorNumber ?? null,
    city: address.city ?? null,
    references: address.references ?? null,
  };
}
