import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
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
import {
  AddressInputDto,
  PostalAddressDto,
} from '../../../platform/http/address.dto.js';
import {
  PageMetaDto,
  PageQueryDto,
} from '../../../platform/http/pagination/page-query.dto.js';
import {
  CommaSeparated,
  IsSortOf,
} from '../../../platform/http/pagination/pagination.js';
import { MAX_MONEY_AMOUNT } from '../../../shared-kernel/index.js';
import {
  ORDER_CHANNELS,
  ORDER_FULFILLMENTS,
  ORDER_STATUSES,
  type OrderChannel,
  type OrderFulfillment,
  type OrderStatus,
  RESTOCK_REASONS,
  type RestockReason,
} from '../application/order-values.js';
import {
  MAX_ORDER_LINE_QUANTITY,
  MAX_STAFF_ORDER_LINES,
} from '../application/staff-order-limits.js';
import {
  AdminOrderPaymentDto,
  AdminOrderShipmentDto,
  OrderFieldsDto,
  OrderLineDto,
  toNormalizedEmail,
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

  /** El estado al que pasó. */
  @ApiProperty({ enum: ORDER_STATUSES })
  toStatus: OrderStatus;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Staff o cliente; `null` si fue el sistema.',
  })
  actorId: string | null;

  /** Motivo que dio el staff; `null` sin él. */
  @ApiProperty({ type: String, nullable: true })
  reason: string | null;

  /** Cuándo ocurrió. */
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

  /** `null` sin número interior. */
  @ApiProperty({ type: String, nullable: true, example: '4B' })
  interiorNumber: string | null;

  @ApiProperty({ ...ANONYMIZED, example: 'Centro' })
  neighborhood: string | null;

  /** @example '58000' */
  postalCode: string;

  /**
   * Clave del INEGI del estado.
   * @example '16'
   */
  stateCode: string;

  /** @example 'Michoacán de Ocampo' */
  stateName: string;

  /**
   * Clave del INEGI del municipio.
   * @example '16053'
   */
  municipalityCode: string;

  /** @example 'Morelia' */
  municipalityName: string;

  /** `null` si no se dio. */
  @ApiProperty({ type: String, nullable: true, example: 'Morelia' })
  city: string | null;

  /** `null` si no se dieron. */
  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Entre Galeana e Hidalgo',
  })
  references: string | null;

  /**
   * Siempre `MX` (ADR-0026).
   * @example 'MX'
   */
  country: string;
}

/** `AdminOrder` in a listing (API_SPEC.md §15.7): without lines nor history. */
export class AdminOrderSummaryDto extends OrderFieldsDto {
  @ApiProperty({ format: 'uuid' })
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
    format: 'uuid',
    nullable: true,
    description: '`null` si la orden es de un invitado.',
  })
  customerId: string | null;

  @ApiProperty({
    enum: ORDER_CHANNELS,
    description:
      '`ONLINE`: la colocó el comprador en la tienda en línea, desde su carrito. `STORE`: la colocó el staff en la tienda física a nombre del cliente (ADR-0161).',
  })
  channel: OrderChannel;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'La cuenta de staff que colocó una orden `STORE`; `null` en una `ONLINE`.',
  })
  placedBy: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'El almacén que eligió el staff para una orden `STORE`: su stock sale solo de ahí; `null` en una `ONLINE`.',
  })
  warehouseId: string | null;

  /** Versión para el bloqueo optimista. */
  version: number;

  /** Cuándo se anonimizaron sus datos personales; `null` si no se han anonimizado (ADR-0070). */
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

  @ApiProperty({
    type: () => AdminOrderAddressDto,
    nullable: true,
    description:
      'La dirección de envío. Los campos personales salen `null` si la orden está bloqueada o anonimizada. `null` en una orden `IN_STORE`, que se entrega en la tienda (ADR-0161).',
  })
  shippingAddress: AdminOrderAddressDto | null;
}

/** A line of `AdminOrder`: with its ID, which a restock names (ADR-0142). */
export class AdminOrderLineDto extends OrderLineDto {
  @ApiProperty({ format: 'uuid' })
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

  @ApiPropertyOptional({
    enum: ORDER_CHANNELS,
    description:
      '`ONLINE`: las de la tienda en línea; `STORE`: las que colocó el staff en la tienda física (ADR-0161).',
  })
  @IsOptional()
  @IsIn(ORDER_CHANNELS)
  channel?: OrderChannel;

  /** Las órdenes que colocó en la tienda física esta cuenta de staff (ADR-0161). */
  @IsOptional()
  @IsUUID('all')
  placedBy?: string;

  /** `placedAt`, `orderNumber` o `grandTotal`, con `-` para orden descendente; por defecto `-placedAt`. */
  @IsOptional()
  @IsSortOf(['placedAt', 'orderNumber', 'grandTotal'])
  sort?: string;
}

/** Units of a variant that an order of the staff asks for (UC-ORD-12 and 13). */
export class StaffOrderLineDto {
  /** Una variante del catálogo. */
  @IsUUID('all')
  variantId: string;

  /** Unidades, de 1 a 30, como una línea del carrito (BR-CRT-02). @example 2 */
  @IsInt()
  @Min(1)
  @Max(MAX_ORDER_LINE_QUANTITY)
  quantity: number;
}

/** Request of `POST /v1/admin/orders/quote` (UC-ORD-12, API_SPEC.md §15.7). */
export class StaffQuoteDto {
  @ApiProperty({
    type: () => [StaffOrderLineDto],
    description: `De 1 a ${MAX_STAFF_ORDER_LINES} líneas, cada variante una sola vez, en el orden en que la orden las numera.`,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_STAFF_ORDER_LINES)
  @ArrayUnique((line: StaffOrderLineDto) => line.variantId?.toLowerCase())
  @ValidateNested({ each: true })
  @Type(() => StaffOrderLineDto)
  lines: StaffOrderLineDto[];

  /** El almacén activo del que sale el stock, el de la tienda: no se toma de otro (ADR-0161). */
  @IsUUID('all')
  warehouseId: string;

  @ApiPropertyOptional({
    enum: ORDER_FULFILLMENTS,
    description:
      '`SHIPPING` (por defecto): se envía a una dirección. `IN_STORE`: venta de mostrador, que el staff entrega en la tienda al pagarse, sin dirección ni costo de envío; el comprador puede no dar sus datos (ADR-0161).',
  })
  @IsOptional()
  @IsIn(ORDER_FULFILLMENTS)
  fulfillment?: OrderFulfillment;
}

/**
 * Request of `POST /v1/admin/orders` (UC-ORD-13, API_SPEC.md §15.7): exactly one of `customerId` and `contactEmail`,
 * and one of `addressId` and `shippingAddress`, which the controller checks.
 */
export class PlaceStaffOrderDto extends StaffQuoteDto {
  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    description:
      'Un cliente registrado y activo, con el email verificado: el contacto es el email de su cuenta. Exactamente uno de `customerId` y `contactEmail`.',
  })
  @IsOptional()
  @IsUUID('all')
  customerId?: string;

  /**
   * Email de contacto de un invitado; se guarda en minúsculas. Exactamente uno de `customerId` y `contactEmail`.
   * @example 'cliente@example.com'
   */
  @IsOptional()
  @Transform(toNormalizedEmail)
  @IsEmail()
  @MaxLength(254)
  contactEmail?: string;

  /**
   * Versión del aviso de privacidad que el staff presentó al invitado (ADR-0067); obligatoria con `contactEmail`, y
   * solo con él: un cliente registrado lo aceptó al crear su cuenta.
   * @example '2026-09'
   */
  @IsOptional()
  @IsString()
  @Length(1, 50)
  @Matches(/\S/, NOT_BLANK)
  privacyNoticeVersion?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    description:
      'Una dirección guardada del cliente, solo con `customerId`; exactamente uno de `addressId` y `shippingAddress`.',
  })
  @IsOptional()
  @IsUUID('all')
  addressId?: string;

  @ApiPropertyOptional({
    type: () => AddressInputDto,
    description: 'Una dirección escrita para la orden, sin guardarla.',
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AddressInputDto)
  shippingAddress?: AddressInputDto;

  /**
   * `grandTotal.amount` de la cotización que aceptó el cliente, en centavos.
   * @example 129700
   */
  @IsInt()
  @Min(0)
  @Max(MAX_MONEY_AMOUNT)
  expectedTotal: number;
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

  /** Un almacén activo al que regresan las unidades; sin él, cada línea regresa al almacén del que salió (ADR-0160). */
  @IsOptional()
  @IsUUID('all')
  warehouseId?: string;

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
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  stockItemId: string;

  @ApiProperty({ enum: ['RESTOCK'] })
  type: string;

  /** Unidades que regresaron. */
  quantity: number;

  /** Unidades físicas después del reintegro. */
  onHandAfter: number;

  /** `ORDER_CANCELLED` o `SHIPMENT_RETURNED`. */
  @ApiProperty({ enum: RESTOCK_REASONS })
  reasonCode: string | null;

  /** Nota del staff; `null` sin ella. */
  @ApiProperty({ type: String, nullable: true })
  note: string | null;

  /** La orden del reintegro. */
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  orderId: string | null;

  /** La línea de la orden que se reintegra. */
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  orderLineId: string | null;

  /** Staff que lo registró. */
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  actorId: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;
}

/** Response of `POST /v1/admin/orders/{orderId}/restocks`: a movement per line. */
export class RestockDto {
  @ApiProperty({ type: () => [RestockMovementDto] })
  movements: RestockMovementDto[];
}

/** Request of `POST /v1/admin/orders/{orderId}/hand-over` (UC-ORD-14, ADR-0161). */
export class HandOverDto {
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
  /**
   * El email de contacto de la orden.
   * @example 'cliente@example.com'
   */
  contactEmail: string;

  @ApiProperty({
    type: () => PostalAddressDto,
    nullable: true,
    description:
      'La dirección de envío de la orden; `null` en una orden `IN_STORE` (ADR-0161).',
  })
  shippingAddress: PostalAddressDto | null;

  @ApiProperty({
    type: () => PostalAddressDto,
    nullable: true,
    description: 'Destino de su envío; `null` si la orden no tiene envío.',
  })
  shipmentDestination: PostalAddressDto | null;
}
