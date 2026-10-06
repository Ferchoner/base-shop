import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../../platform/auth/authorization.decorators.js';
import { ApiProblemResponses } from '../../../platform/http/problem-details/api-problem-responses.decorator.js';
import { ConfigurePaymentSettings } from '../application/configure-payment-settings.use-case.js';
import { PaymentsQueries } from '../application/payments.queries.js';
import {
  PaymentSettingsDto,
  UpdatePaymentSettingsDto,
} from './payment-settings.dto.js';

/**
 * The settings of Payments (UC-PAY-08, API_SPEC.md §16.6, ADR-0162): read with `orders.read`, like the payments,
 * and changed only with `payments.configure`, which only the superadmin role holds. Out of `/v1/admin/payments`,
 * where `settings` would clash with `{paymentId}`.
 */
@ApiTags('Administración: pagos')
@ApiProblemResponses('unauthenticated', 'forbidden', 'password-change-required')
@Controller('admin/payment-settings')
export class AdminPaymentSettingsController {
  constructor(
    private readonly queries: PaymentsQueries,
    private readonly configurePaymentSettings: ConfigurePaymentSettings,
  ) {}

  @ApiOperation({
    summary: 'Consultar si el pago manual está habilitado',
    description:
      'Si la tienda registra pagos y reembolsos manuales, y si el cliente puede elegir pagar en la tienda (ADR-0162). Con el pago manual deshabilitado, esas acciones responden 403 `manual-payments-disabled`.',
  })
  @ApiOkResponse({ type: PaymentSettingsDto })
  @RequirePermissions('orders.read')
  @Get()
  get(): Promise<PaymentSettingsDto> {
    return this.queries.findSettings();
  }

  @ApiOperation({
    summary: 'Habilitar o deshabilitar el pago manual',
    description:
      'Solo un superadministrador: `payments.configure` no lo tiene ningún otro rol (ADR-0162). Vale desde la siguiente operación; un pago que ya pasó la comprobación termina. Cada cambio se audita; sin cambios no se guarda ni se audita.',
  })
  @ApiOkResponse({ type: PaymentSettingsDto })
  @ApiProblemResponses('version-conflict')
  @RequirePermissions('payments.configure')
  @Put()
  async update(
    @Body() body: UpdatePaymentSettingsDto,
  ): Promise<PaymentSettingsDto> {
    await this.configurePaymentSettings.execute(body);
    return this.queries.findSettings();
  }
}
