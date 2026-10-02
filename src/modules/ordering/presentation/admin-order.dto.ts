import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
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
import { PostalAddressDto } from '../../../platform/http/address.dto.js';
import {
  PageMetaDto,
  PageQueryDto,
} from '../../../platform/http/pagination/page-query.dto.js';
import {
  CommaSeparated,
  IsSortOf,
} from '../../../platform/http/pagination/pagination.js';
import {
  ORDER_STATUSES,
  type OrderStatus,
} from '../application/order-values.js';
import {
  AdminOrderPaymentDto,
  AdminOrderShipmentDto,
  OrderFieldsDto,
  OrderLineDto,
} from './order.dto.js';

// Plain string, number and boolean fields are documented by the Swagger plugin from their types and comments;
// fields holding other DTOs, lists, dates, enums, objects or null declare their type with @ApiProperty
// (DEVELOPMENT_GUIDE.md).

const NOT_BLANK = { context: { message: 'No puede estar vacío.' } };

const toBoolean = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

/** An entry of `statusHistory` (API_SPEC.md §8.9). */
export class StatusHistoryEntryDto {
  @ApiProperty({
    enum: ORDER_STATUSES,
    nullable: true,
    description: '`null` al colocar la orden.',
  })
  fromStatus: OrderStatus | null;

  @ApiProperty({ enum: ORDER_STATUSES })
  toStatus: OrderStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Staff o cliente; `null` si fue el sistema.',
  })
  actorId: string | null;

  @ApiProperty({ type: String, nullable: true })
  reason: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  occurredAt: Date;
}

/** `AdminOrder` in a listing (API_SPEC.md §15.7): without lines nor history. */
export class AdminOrderSummaryDto extends OrderFieldsDto {
  id: string;

  @ApiProperty({
    type: () => AdminOrderPaymentDto,
    nullable: true,
    description: '`null` mientras la orden no tenga pago.',
  })
  payment: AdminOrderPaymentDto | null;

  @ApiProperty({
    type: () => AdminOrderShipmentDto,
    nullable: true,
    description: '`null` mientras la orden no tenga envío.',
  })
  shipment: AdminOrderShipmentDto | null;

  /** Número interno consecutivo; solo para el staff (ADR-0049). @example 1042 */
  orderNumber: number;

  @ApiProperty({
    type: String,
    nullable: true,
    description: '`null` si la orden es de un invitado.',
  })
  customerId: string | null;

  /** Versión para el bloqueo optimista. */
  version: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  anonymizedAt: Date | null;

  @ApiProperty({ type: () => PostalAddressDto })
  shippingAddress: PostalAddressDto;
}

/** `AdminOrder` of API_SPEC.md §8.9. */
export class AdminOrderDto extends AdminOrderSummaryDto {
  @ApiProperty({ type: () => [OrderLineDto] })
  lines: OrderLineDto[];

  @ApiProperty({
    type: () => [StatusHistoryEntryDto],
    description: 'Del más antiguo al más reciente.',
  })
  statusHistory: StatusHistoryEntryDto[];
}

export class AdminOrderListDto {
  @ApiProperty({ type: () => [AdminOrderSummaryDto] })
  data: AdminOrderSummaryDto[];

  @ApiProperty({ type: () => PageMetaDto })
  meta: PageMetaDto;
}

/** Query of `GET /v1/admin/orders` (UC-ORD-06, API_SPEC.md §15.7). */
export class AdminOrderListQueryDto extends PageQueryDto {
  /**
   * Número interno o código público exactos (con o sin guion, sin distinguir mayúsculas), o parte del email
   * de contacto.
   */
  @IsOptional()
  @IsString()
  @MaxLength(254)
  q?: string;

  @ApiPropertyOptional({
    type: String,
    description: `Uno o más estados separados por comas: ${ORDER_STATUSES.map((status) => `\`${status}\``).join(', ')}.`,
    example: 'PAID,AWAITING_MANUAL_FULFILLMENT',
  })
  @IsOptional()
  @CommaSeparated()
  @IsIn(ORDER_STATUSES, { each: true })
  status?: OrderStatus[];

  /** Órdenes de un cliente. */
  @IsOptional()
  @IsUUID('all')
  customerId?: string;

  @ApiPropertyOptional({
    type: Boolean,
    description: '`true`: solo invitados; `false`: solo clientes.',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  guest?: boolean;

  /** Fecha o fecha y hora ISO 8601; incluida. @example '2026-10-01' */
  @IsOptional()
  @IsISO8601({ strict: true })
  placedFrom?: string;

  /** Fecha o fecha y hora ISO 8601; incluida (una fecha sola incluye todo el día). @example '2026-10-31' */
  @IsOptional()
  @IsISO8601({ strict: true })
  placedTo?: string;

  @ApiPropertyOptional({
    type: Boolean,
    description:
      '`true`: canceladas con pago capturado que esperan su reembolso (ADR-0051).',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  hasPendingRefund?: boolean;

  /** `placedAt`, `orderNumber` o `grandTotal`, con `-` para orden descendente; por defecto `-placedAt`. */
  @IsOptional()
  @IsSortOf(['placedAt', 'orderNumber', 'grandTotal'])
  sort?: string;
}

/** Request of `POST /v1/admin/orders/{orderId}/cancel` (UC-ORD-07). */
export class CancelOrderDto {
  /**
   * Motivo, de 1 a 500 caracteres. Queda en el historial y en la auditoría: no escribas datos personales.
   * @example 'El cliente lo pidió por teléfono'
   */
  @IsString()
  @Length(1, 500)
  @Matches(/\S/, NOT_BLANK)
  reason: string;

  /**
   * Reintegrar todo el stock; solo en `PAID` y con `inventory.write` (ADR-0052). Las órdenes pagadas se
   * cancelan desde T-190.
   */
  @IsOptional()
  @IsBoolean()
  restock?: boolean;

  /** Versión leída (bloqueo optimista). */
  @IsInt()
  @Min(1)
  version: number;
}

/** Request of `POST /v1/admin/orders/{orderId}/retry-fulfillment` (UC-ORD-08). */
export class RetryFulfillmentDto {
  /** Versión leída (bloqueo optimista). */
  @IsInt()
  @Min(1)
  version: number;
}
