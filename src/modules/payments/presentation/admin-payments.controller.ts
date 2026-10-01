import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../../platform/auth/authorization.decorators.js';
import { toMoneyDto } from '../../../platform/http/money.dto.js';
import {
  rangeEnd,
  toPageResponse,
  toSortOrders,
} from '../../../platform/http/pagination/pagination.js';
import { pathId } from '../../../platform/http/path-id.js';
import { ApiProblemResponses } from '../../../platform/http/problem-details/api-problem-responses.decorator.js';
import { NotFoundError, toId } from '../../../shared-kernel/index.js';
import {
  type AdminPaymentView,
  PaymentsQueries,
  type PaymentSortField,
} from '../application/payments.queries.js';
import {
  AdminPaymentDto,
  AdminPaymentListDto,
  AdminPaymentListQueryDto,
} from './admin-payment.dto.js';

/**
 * Payments for the staff (API_SPEC.md §16.3). Reading them takes `orders.read`: the catalog of permissions has
 * none to read payments, and the payment is part of the view of an order (ADR-0071).
 */
@ApiTags('Administración: pagos')
@ApiProblemResponses('unauthenticated', 'forbidden', 'password-change-required')
@Controller('admin/payments')
export class AdminPaymentsController {
  constructor(private readonly queries: PaymentsQueries) {}

  @ApiOperation({ summary: 'Listar pagos' })
  @ApiOkResponse({ type: AdminPaymentListDto })
  @RequirePermissions('orders.read')
  @Get()
  async list(
    @Query() query: AdminPaymentListQueryDto,
  ): Promise<AdminPaymentListDto> {
    const page = await this.queries.listPayments(
      {
        status: query.status,
        provider: query.provider,
        orderId:
          query.orderId === undefined
            ? undefined
            : toId<'Order'>(query.orderId),
        capturedFrom:
          query.capturedFrom === undefined
            ? undefined
            : new Date(query.capturedFrom),
        capturedTo: rangeEnd(query.capturedTo),
      },
      toSortOrders<PaymentSortField>(query.sort, '-createdAt'),
      query,
    );
    return toPageResponse(page, query, toAdminPaymentDto);
  }

  @ApiOperation({ summary: 'Consultar un pago, con sus intentos y reembolsos' })
  @ApiOkResponse({ type: AdminPaymentDto })
  @ApiProblemResponses('not-found')
  @RequirePermissions('orders.read')
  @Get(':paymentId')
  async get(@Param('paymentId') paymentId: string): Promise<AdminPaymentDto> {
    const id = pathId<'Payment'>(paymentId, 'Payment');
    const payment = await this.queries.findPayment(id);
    if (payment === null) throw new NotFoundError('Payment', id);
    return toAdminPaymentDto(payment);
  }
}

/** `AdminPayment` of API_SPEC.md §16.3, with the public code as people see it (ADR-0049). */
function toAdminPaymentDto(view: AdminPaymentView): AdminPaymentDto {
  return {
    id: view.id,
    orderId: view.orderId,
    orderCode: `${view.orderCode.slice(0, 4)}-${view.orderCode.slice(4)}`,
    provider: view.provider,
    status: view.status,
    amount: toMoneyDto(view.amount),
    capturedAmount: toMoneyDto(view.capturedAmount),
    refundedAmount: toMoneyDto(view.refundedAmount),
    currency: view.amount.currency,
    providerPaymentId: view.providerPaymentId,
    capturedAt: view.capturedAt,
    attempts: view.attempts.map((attempt) => ({ ...attempt })),
    refunds: view.refunds.map((refund) => ({
      ...refund,
      amount: toMoneyDto(refund.amount),
    })),
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
    version: view.version,
  };
}
