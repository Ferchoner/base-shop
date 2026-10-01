import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsOptional, IsUUID } from 'class-validator';
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
  PAYMENT_PROVIDERS,
  PAYMENT_STATUSES,
  type PaymentProvider,
  type PaymentStatus,
} from '../application/payment-values.js';

// Plain string, number and boolean fields are documented by the Swagger plugin from their types and comments;
// fields holding other DTOs, lists, dates, enums, objects or null declare their type with @ApiProperty
// (DEVELOPMENT_GUIDE.md).

/** An attempt of `AdminPayment` (API_SPEC.md §16.3). */
export class PaymentAttemptDto {
  @ApiProperty({ enum: PAYMENT_STATUSES })
  status: PaymentStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Comprobante de la tienda en un pago manual.',
  })
  providerReference: string | null;

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
  id: string;

  @ApiProperty({ type: () => MoneyDto })
  amount: MoneyDto;

  @ApiProperty({ enum: ['PENDING', 'COMPLETED', 'FAILED'] })
  status: string;

  @ApiProperty({ type: String, nullable: true })
  providerRefundId: string | null;

  @ApiProperty({ type: String, nullable: true })
  registeredBy: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  completedAt: Date | null;
}

/** `AdminPayment` of API_SPEC.md §16.3. */
export class AdminPaymentDto {
  id: string;

  orderId: string;

  /** Código público de la orden. @example 'K7M4-Q9XA' */
  orderCode: string;

  @ApiProperty({ enum: PAYMENT_PROVIDERS })
  provider: PaymentProvider;

  @ApiProperty({ enum: PAYMENT_STATUSES })
  status: PaymentStatus;

  @ApiProperty({ type: () => MoneyDto, description: 'El total de la orden.' })
  amount: MoneyDto;

  @ApiProperty({ type: () => MoneyDto })
  capturedAmount: MoneyDto;

  @ApiProperty({ type: () => MoneyDto })
  refundedAmount: MoneyDto;

  @ApiProperty({ enum: ['MXN'], example: 'MXN' })
  currency: string;

  @ApiProperty({ type: String, nullable: true })
  providerPaymentId: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  capturedAt: Date | null;

  @ApiProperty({
    type: () => [PaymentAttemptDto],
    description: 'Del más antiguo al más reciente.',
  })
  attempts: PaymentAttemptDto[];

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
