import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { MoneyDto } from '../../../platform/http/money.dto.js';
import {
  PageMetaDto,
  PageQueryDto,
} from '../../../platform/http/pagination/page-query.dto.js';
import {
  CommaSeparated,
  IsSortOf,
} from '../../../platform/http/pagination/pagination.js';
import {
  PAYMENT_METHODS,
  PAYMENT_PROVIDERS,
  PAYMENT_STATUSES,
  type PaymentMethod,
  type PaymentProvider,
  type PaymentStatus,
} from '../application/payment-values.js';

// Plain string, number and boolean fields are documented by the Swagger plugin from their types and comments;
// fields holding other DTOs, lists, dates, enums, objects or null declare their type with @ApiProperty
// (DEVELOPMENT_GUIDE.md).

/** An attempt of `AdminPayment` (API_SPEC.md §16.3). */
export class PaymentAttemptDto {
  /** El estado al que llevó el intento. */
  @ApiProperty({ enum: PAYMENT_STATUSES })
  status: PaymentStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Comprobante de la tienda en un pago manual.',
  })
  providerReference: string | null;

  @ApiProperty({
    enum: PAYMENT_METHODS,
    nullable: true,
    description:
      'Cómo cobró la tienda un pago manual: `CASH`, `CARD_TERMINAL` o `TRANSFER` (ADR-0161); `null` en los demás intentos, o si el staff no lo dijo.',
  })
  method: PaymentMethod | null;

  /** El código de error del proveedor; `null` si no falló. */
  @ApiProperty({ type: String, nullable: true })
  failureCode: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Staff que registró el pago manual.',
  })
  registeredBy: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;
}

/** A refund of `AdminPayment` (API_SPEC.md §16.3, ADR-0051). */
export class RefundDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: () => MoneyDto })
  amount: MoneyDto;

  /** `PENDING` hasta que el dinero se devuelve; `COMPLETED` o `FAILED` después. */
  @ApiProperty({ enum: ['PENDING', 'COMPLETED', 'FAILED'] })
  status: string;

  /**
   * Comprobante del reembolso: el del proveedor o, en uno manual, el que registró el staff; `null` mientras está
   * pendiente.
   */
  @ApiProperty({ type: String, nullable: true })
  providerRefundId: string | null;

  /** Staff que registró el reembolso manual; `null` en los demás. */
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  registeredBy: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  /** Cuándo se completó; `null` si no se ha completado. */
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  completedAt: Date | null;
}

/** `AdminPayment` of API_SPEC.md §16.3. */
export class AdminPaymentDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  /** La orden del pago. */
  @ApiProperty({ format: 'uuid' })
  orderId: string;

  /** Código público de la orden. @example 'K7M4-Q9XA' */
  orderCode: string;

  /** `MANUAL` es el pago en la tienda (ADR-0055); PayPal aún no está habilitado (ADR-0040). */
  @ApiProperty({ enum: PAYMENT_PROVIDERS })
  provider: PaymentProvider;

  /**
   * Estado del pago: `PENDING` mientras no se cobra, `CAPTURED` al cobrarse, y `PARTIALLY_REFUNDED` o `REFUNDED` según
   * sus reembolsos.
   */
  @ApiProperty({ enum: PAYMENT_STATUSES })
  status: PaymentStatus;

  @ApiProperty({ type: () => MoneyDto, description: 'El total de la orden.' })
  amount: MoneyDto;

  /** Lo cobrado; 0 mientras no se cobra. */
  @ApiProperty({ type: () => MoneyDto })
  capturedAmount: MoneyDto;

  /** Lo reembolsado, de los reembolsos completados. */
  @ApiProperty({ type: () => MoneyDto })
  refundedAmount: MoneyDto;

  /** Siempre `MXN` (ADR-0026). */
  @ApiProperty({ enum: ['MXN'], example: 'MXN' })
  currency: string;

  /** El ID del pago en el proveedor; `null` en un pago en la tienda. */
  @ApiProperty({ type: String, nullable: true })
  providerPaymentId: string | null;

  /** Cuándo se cobró; `null` si no se ha cobrado. */
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  capturedAt: Date | null;

  @ApiProperty({
    type: () => [PaymentAttemptDto],
    description: 'Del más antiguo al más reciente.',
  })
  attempts: PaymentAttemptDto[];

  /** Del más antiguo al más reciente. */
  @ApiProperty({ type: () => [RefundDto] })
  refunds: RefundDto[];

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: Date;

  /** Versión para el bloqueo optimista. */
  version: number;
}

export class AdminPaymentListDto {
  @ApiProperty({ type: () => [AdminPaymentDto] })
  data: AdminPaymentDto[];

  @ApiProperty({ type: () => PageMetaDto })
  meta: PageMetaDto;
}

/** Query of `GET /v1/admin/payments` (API_SPEC.md §16.3). */
export class AdminPaymentListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    type: String,
    description: `Uno o más estados separados por comas: ${PAYMENT_STATUSES.map((status) => `\`${status}\``).join(', ')}.`,
    example: 'CAPTURED',
  })
  @IsOptional()
  @CommaSeparated()
  @IsIn(PAYMENT_STATUSES, { each: true })
  status?: PaymentStatus[];

  @ApiPropertyOptional({
    type: String,
    description:
      'Uno o más proveedores separados por comas: `MANUAL`, `PAYPAL`.',
    example: 'MANUAL',
  })
  @IsOptional()
  @CommaSeparated()
  @IsIn(PAYMENT_PROVIDERS, { each: true })
  provider?: PaymentProvider[];

  /** El pago de una orden. */
  @IsOptional()
  @IsUUID('all')
  orderId?: string;

  /** Fecha o fecha y hora ISO 8601; incluida. @example '2026-10-01' */
  @IsOptional()
  @IsISO8601({ strict: true })
  capturedFrom?: string;

  /** Fecha o fecha y hora ISO 8601; incluida (una fecha sola incluye todo el día). @example '2026-10-31' */
  @IsOptional()
  @IsISO8601({ strict: true })
  capturedTo?: string;

  /** `createdAt` o `amount`, con `-` para orden descendente; por defecto `-createdAt`. */
  @IsOptional()
  @IsSortOf(['createdAt', 'amount'])
  sort?: string;
}

const NOT_BLANK = { context: { message: 'No puede estar vacío.' } };

/** Request of `POST /v1/admin/payments/{paymentId}/refunds/manual` (UC-PAY-06, API_SPEC.md §16.5). */
export class ManualRefundDto {
  /**
   * Comprobante del reembolso hecho fuera del sistema, de 1 a 100 caracteres.
   * @example 'Devolución 00087'
   */
  @IsString()
  @Length(1, 100)
  @Matches(/\S/, NOT_BLANK)
  reference: string;

  /**
   * Nota de hasta 500 caracteres; queda en la auditoría: no escribas datos personales.
   * @example 'Devuelto en efectivo en la tienda'
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  /** Versión leída del pago (bloqueo optimista). */
  @IsInt()
  @Min(1)
  version: number;
}
