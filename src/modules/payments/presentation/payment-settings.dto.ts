import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsInt, Min } from 'class-validator';

// Plain string, number and boolean fields are documented by the Swagger plugin from their types and comments.
// Fields holding other DTOs, dates or null declare their type with @ApiProperty (DEVELOPMENT_GUIDE.md).

/** `PaymentSettings` of API_SPEC.md §16.6 (ADR-0162). */
export class PaymentSettingsDto {
  /**
   * Si la tienda registra pagos y reembolsos manuales, y si el cliente puede elegir pagar en la tienda. Con
   * `false`, esas acciones responden 403 `manual-payments-disabled`.
   * @example true
   */
  manualPaymentsEnabled: boolean;

  /** Versión para el bloqueo optimista: se envía al cambiarla. */
  version: number;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: Date;
}

/** `PUT /v1/admin/payment-settings` (UC-PAY-08): replaces every setting. */
export class UpdatePaymentSettingsDto {
  /**
   * `true` habilita el pago manual en tienda; `false` lo deshabilita.
   * @example true
   */
  @IsBoolean()
  manualPaymentsEnabled: boolean;

  /** Versión leída (bloqueo optimista). */
  @IsInt()
  @Min(1)
  version: number;
}
