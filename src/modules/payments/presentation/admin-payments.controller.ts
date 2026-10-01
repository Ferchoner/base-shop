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
import { toMoneyDto } from '../../../platform/http/money.dto.js';
import {
  rangeEnd,
  toPageResponse,
  toSortOrders,
} from '../../../platform/http/pagination/pagination.js';
import { pathId } from '../../../platform/http/path-id.js';
import { ApiProblemResponses } from '../../../platform/http/problem-details/api-problem-responses.decorator.js';
import { ProblemException } from '../../../platform/http/problem-details/problem.exception.js';
import { NotFoundError, toId } from '../../../shared-kernel/index.js';
import { PaymentsFacade } from '../application/payments.facade.js';
import {
  type AdminPaymentView,
  PaymentsQueries,
  type PaymentSortField,
} from '../application/payments.queries.js';
import {
  AdminPaymentDto,
  AdminPaymentListDto,
  AdminPaymentListQueryDto,
  ManualRefundDto,
} from './admin-payment.dto.js';

/**
 * Payments for the staff (API_SPEC.md §16.3). Reading them takes `orders.read`: the catalog of permissions has
 * none to read payments, and the payment is part of the view of an order (ADR-0071).
 */
@ApiTags('Administración: pagos')
@ApiProblemResponses('unauthenticated', 'forbidden', 'password-change-required')
@Controller('admin/payments')
export class AdminPaymentsController {
  constructor(
    private readonly queries: PaymentsQueries,
    private readonly payments: PaymentsFacade,
  ) {}

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
  get(@Param('paymentId') paymentId: string): Promise<AdminPaymentDto> {
    return this.read(pathId<'Payment'>(paymentId, 'Payment'));
  }

  @ApiOperation({
    summary: 'Registrar el reembolso de un pago manual',
    description:
      'Solo con el pago manual habilitado, y para un pago `MANUAL` con su reembolso pendiente, que inicia la cancelación de su pedido (ADR-0051). Completa el reembolso por todo lo capturado; el pedido pasa a `REFUNDED` en segundo plano (API_SPEC.md §2.5). `restock` necesita además `inventory.write` y llega con T-161 (ADR-0135).',
  })
  @ApiOkResponse({ type: AdminPaymentDto })
  @ApiProblemResponses(
    'manual-payments-disabled',
    'not-found',
    'version-conflict',
    'invalid-state-transition',
    'restock-not-allowed',
  )
  @RequirePermissions('payments.manage')
  @HttpCode(200)
  @Post(':paymentId/refunds/manual')
  async registerManualRefund(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('paymentId') paymentId: string,
    @Body() body: ManualRefundDto,
  ): Promise<AdminPaymentDto> {
    const id = pathId<'Payment'>(paymentId, 'Payment');
    const restock = body.restock === true;
    if (restock && !actor.permissions.includes('inventory.write')) {
      throw new ProblemException('forbidden');
    }
    const note = body.note?.trim() ?? '';
    await this.payments.registerManualRefund(id, {
      reference: body.reference.trim(),
      note: note === '' ? null : note,
      restock,
      version: body.version,
      registeredBy: toId<'User'>(actor.id),
    });
    return this.read(id);
  }

  private async read(
    id: ReturnType<typeof pathId<'Payment'>>,
  ): Promise<AdminPaymentDto> {
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
