import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
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
  RESTOCK_REASONS,
  type RestockReason,
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

const ANONYMIZED = {
  type: String,
  nullable: true,
  description: '`null` cuando la orden está anonimizada (ADR-0067).',
} as const;

/**
 * The shipping address of `AdminOrder` (API_SPEC.md §8.2 and §8.9): once the order is anonymized it keeps only the
 * state, the municipality, the postal code and the country, and the rest is `null` (ADR-0067).
 */
export class AdminOrderAddressDto {
  @ApiProperty({ ...ANONYMIZED, example: 'María López Hernández' })
  recipientName: string | null;

  @ApiProperty({ ...ANONYMIZED, example: '4431234567' })
  phone: string | null;

  @ApiProperty({ ...ANONYMIZED, example: 'Av. Madero Poniente' })
  street: string | null;

  @ApiProperty({ ...ANONYMIZED, example: '123' })
  exteriorNumber: string | null;

  @ApiProperty({ type: String, nullable: true, example: '4B' })
  interiorNumber: string | null;

  @ApiProperty({ ...ANONYMIZED, example: 'Centro' })
  neighborhood: string | null;

  /** @example '58000' */
  postalCode: string;

  /** @example '16' */
  stateCode: string;

  /** @example 'Michoacán de Ocampo' */
  stateName: string;

  /** @example '16053' */
  municipalityCode: string;

  /** @example 'Morelia' */
  municipalityName: string;

  @ApiProperty({ type: String, nullable: true, example: 'Morelia' })
  city: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Entre Galeana e Hidalgo',
  })
  references: string | null;

  /** @example 'MX' */
  country: string;
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

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'Cuándo se bloquearon los datos personales de la orden: desde entonces, `contactEmail` y la dirección se muestran como anonimizados (ADR-0070).',
  })
  blockedAt: Date | null;

  @ApiProperty({ type: () => AdminOrderAddressDto })
  shippingAddress: AdminOrderAddressDto;
}

/** A line of `AdminOrder`: with its ID, which a restock names (ADR-0142). */
export class AdminOrderLineDto extends OrderLineDto {
  id: string;
}

/** `AdminOrder` of API_SPEC.md §8.9. */
export class AdminOrderDto extends AdminOrderSummaryDto {
  @ApiProperty({ type: () => [AdminOrderLineDto] })
  lines: AdminOrderLineDto[];

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
   * Reintegrar todas las líneas completas en la misma operación; solo en `PAID` y con `inventory.write`
   * (ADR-0052, ADR-0142).
   */
  @IsOptional()
  @IsBoolean()
  restock?: boolean;

  /** Versión leída (bloqueo optimista). */
  @IsInt()
  @Min(1)
  version: number;
}

/** A line of a restock: what comes back of one line of the order. */
export class RestockLineDto {
  /** Una línea de la orden. */
  @IsUUID('all')
  orderLineId: string;

  /** Unidades que regresan, de 1 a lo vendido menos lo ya reintegrado. @example 1 */
  @IsInt()
  @Min(1)
  @Max(100_000)
  quantity: number;
}

/** Request of `POST /v1/admin/orders/{orderId}/restocks` (UC-INV-09, API_SPEC.md §15.7). */
export class RestockOrderDto {
  @ApiProperty({
    enum: RESTOCK_REASONS,
    description:
      '`ORDER_CANCELLED` para una orden `CANCELLED` o `REFUNDED`; `SHIPMENT_RETURNED` para una orden con el envío `RETURNED`.',
  })
  @IsIn(RESTOCK_REASONS)
  reasonCode: RestockReason;

  @ApiProperty({
    type: () => [RestockLineDto],
    description: 'De 1 a 100 líneas de la orden, cada una una sola vez.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique((line: RestockLineDto) => line.orderLineId?.toLowerCase())
  @ValidateNested({ each: true })
  @Type(() => RestockLineDto)
  lines: RestockLineDto[];

  /**
   * Nota de hasta 500 caracteres, en cada movimiento y en la auditoría: no escribas datos personales.
   * @example 'Regresó en su caja original'
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** `StockMovement` of API_SPEC.md §13: a RESTOCK movement. */
export class RestockMovementDto {
  id: string;

  stockItemId: string;

  @ApiProperty({ enum: ['RESTOCK'] })
  type: string;

  /** Unidades que regresaron. */
  quantity: number;

  onHandAfter: number;

  @ApiProperty({ enum: RESTOCK_REASONS })
  reasonCode: string | null;

  @ApiProperty({ type: String, nullable: true })
  note: string | null;

  @ApiProperty({ type: String, nullable: true })
  orderId: string | null;

  @ApiProperty({ type: String, nullable: true })
  orderLineId: string | null;

  @ApiProperty({ type: String, nullable: true })
  actorId: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;
}

/** Response of `POST /v1/admin/orders/{orderId}/restocks`: a movement per line. */
export class RestockDto {
  @ApiProperty({ type: () => [RestockMovementDto] })
  movements: RestockMovementDto[];
}

/** Request of `POST /v1/admin/orders/{orderId}/retry-fulfillment` (UC-ORD-08). */
export class RetryFulfillmentDto {
  /** Versión leída (bloqueo optimista). */
  @IsInt()
  @Min(1)
  version: number;
}

/** Request of `POST /v1/admin/orders/{orderId}/blocked-data` (ADR-0070, ADR-0152). */
export class BlockedOrderDataRequestDto {
  /**
   * La reclamación o el requerimiento que se atiende, de 1 a 500 caracteres. Queda en la auditoría: no escribas datos
   * personales.
   * @example 'Reclamación PROFECO 2027-0153'
   */
  @IsString()
  @Length(1, 500)
  @Matches(/\S/, NOT_BLANK)
  reason: string;
}

/** Response of `POST /v1/admin/orders/{orderId}/blocked-data`: the personal data of the order, as it was saved. */
export class BlockedOrderDataDto {
  /** @example 'cliente@example.com' */
  contactEmail: string;

  @ApiProperty({ type: () => PostalAddressDto })
  shippingAddress: PostalAddressDto;

  @ApiProperty({
    type: () => PostalAddressDto,
    nullable: true,
    description: 'Destino de su envío; `null` si la orden no tiene envío.',
  })
  shipmentDestination: PostalAddressDto | null;
}
