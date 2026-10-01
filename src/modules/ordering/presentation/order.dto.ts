import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
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
import { MoneyDto } from '../../../platform/http/money.dto.js';
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
  ORDER_STATUSES,
  type OrderStatus,
} from '../application/order-values.js';
import { EstimatedDeliveryDto } from './checkout.dto.js';

// Plain string, number and boolean fields are documented by the Swagger plugin from their types and comments;
// fields holding other DTOs, lists, dates, enums, objects or null declare their type with @ApiProperty
// (DEVELOPMENT_GUIDE.md).

const NOT_BLANK = { context: { message: 'No puede estar vacío.' } };

/** Emails are compared in lowercase and without surrounding spaces, as in Identity (BR-USR-01). */
const toNormalizedEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/** Request of `POST /v1/orders` (UC-ORD-02, API_SPEC.md §15.3). */
export class PlaceGuestOrderDto {
  /** El `cartId` del carrito de invitado; también es el alcance de `Idempotency-Key`. */
  @IsUUID('all')
  cartId: string;

  /**
   * Email de contacto del pedido; se guarda en minúsculas.
   * @example 'cliente@example.com'
   */
  @Transform(toNormalizedEmail)
  @IsEmail()
  @MaxLength(254)
  contactEmail: string;

  @ApiProperty({ type: () => AddressInputDto })
  @IsObject()
  @ValidateNested()
  @Type(() => AddressInputDto)
  shippingAddress: AddressInputDto;

  /**
   * `grandTotal.amount` de la cotización aceptada, en centavos.
   * @example 129700
   */
  @IsInt()
  @Min(0)
  @Max(MAX_MONEY_AMOUNT)
  expectedTotal: number;

  /**
   * Versión del aviso de privacidad que se mostró al comprar (ADR-0067).
   * @example '2026-09'
   */
  @IsString()
  @Length(1, 50)
  @Matches(/\S/, NOT_BLANK)
  privacyNoticeVersion: string;
}

/**
 * Request of `POST /v1/me/orders` (UC-ORD-02, API_SPEC.md §15.3): exactly one of `addressId` and
 * `shippingAddress`, which the controller checks.
 */
export class PlaceCustomerOrderDto {
  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    description:
      'Una dirección guardada del cliente; exactamente uno de `addressId` y `shippingAddress`.',
  })
  @IsOptional()
  @IsUUID('all')
  addressId?: string;

  @ApiPropertyOptional({
    type: () => AddressInputDto,
    description: 'Una dirección sin guardarla en la libreta.',
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AddressInputDto)
  shippingAddress?: AddressInputDto;

  /**
   * `grandTotal.amount` de la cotización aceptada, en centavos.
   * @example 129700
   */
  @IsInt()
  @Min(0)
  @Max(MAX_MONEY_AMOUNT)
  expectedTotal: number;
}

/** A line of `Order` (API_SPEC.md §8.8), as it was sold. */
export class OrderLineDto {
  /** @example 1 */
  lineNumber: number;

  /** @example 'CAM-LIN-AZ-M' */
  sku: string;

  /** @example 'Camisa de lino' */
  productName: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    example: { talla: 'M' },
  })
  variantOptions: Record<string, string>;

  @ApiProperty({ type: () => MoneyDto })
  unitPrice: MoneyDto;

  /** @example 2 */
  quantity: number;

  /** Tasa de IVA en puntos base. @example 1600 */
  taxRateBp: number;

  @ApiProperty({ type: () => MoneyDto })
  taxAmount: MoneyDto;

  @ApiProperty({ type: () => MoneyDto })
  lineTotal: MoneyDto;
}

/** The payment of an order, as the customer sees it (T-190). */
export class OrderPaymentDto {
  @ApiProperty({ enum: ['MANUAL', 'PAYPAL'] })
  provider: string;

  @ApiProperty({
    enum: [
      'PENDING',
      'REQUIRES_ACTION',
      'AUTHORIZED',
      'CAPTURED',
      'FAILED',
      'CANCELLED',
      'PARTIALLY_REFUNDED',
      'REFUNDED',
    ],
  })
  status: string;
}

/** A refund of the payment of an order (ADR-0051). */
export class OrderRefundDto {
  id: string;

  @ApiProperty({ type: () => MoneyDto })
  amount: MoneyDto;

  @ApiProperty({ enum: ['PENDING', 'COMPLETED', 'FAILED'] })
  status: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  completedAt: Date | null;
}

/** The payment of an order, as the staff sees it (API_SPEC.md §8.9). */
export class AdminOrderPaymentDto extends OrderPaymentDto {
  id: string;

  @ApiProperty({ type: () => MoneyDto, description: 'El total de la orden.' })
  amount: MoneyDto;

  @ApiProperty({ type: () => MoneyDto })
  capturedAmount: MoneyDto;

  @ApiProperty({ type: () => MoneyDto })
  refundedAmount: MoneyDto;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  capturedAt: Date | null;

  @ApiProperty({ type: () => [OrderRefundDto] })
  refunds: OrderRefundDto[];
}

/** The shipment of an order, as the customer sees it (T-195). */
export class OrderShipmentDto {
  @ApiProperty({
    enum: ['PENDING', 'DISPATCHED', 'DELIVERED', 'DELIVERY_FAILED', 'RETURNED'],
  })
  status: string;

  @ApiProperty({ type: String, nullable: true })
  carrierName: string | null;

  @ApiProperty({ type: String, nullable: true })
  trackingNumber: string | null;

  ownDelivery: boolean;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  dispatchedAt: Date | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  deliveredAt: Date | null;
}

/**
 * What every view of an order shares (API_SPEC.md §8.8): each adds its own `payment`. Never the internal number
 * nor the ID for a customer (ADR-0049).
 */
export class OrderFieldsDto {
  /** @example 'K7M4-Q9XA' */
  publicCode: string;

  @ApiProperty({ enum: ORDER_STATUSES })
  status: OrderStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'cliente@example.com',
    description: '`null` solo en órdenes anonimizadas (ADR-0067).',
  })
  contactEmail: string | null;

  /** Unidades de todas las líneas. */
  itemCount: number;

  @ApiProperty({ type: () => MoneyDto })
  subtotal: MoneyDto;

  @ApiProperty({ type: () => MoneyDto })
  taxTotal: MoneyDto;

  @ApiProperty({ type: () => MoneyDto })
  shippingCost: MoneyDto;

  @ApiProperty({ type: () => MoneyDto })
  shippingTaxAmount: MoneyDto;

  @ApiProperty({ type: () => MoneyDto })
  discountTotal: MoneyDto;

  @ApiProperty({ type: () => MoneyDto })
  grandTotal: MoneyDto;

  @ApiProperty({ type: () => EstimatedDeliveryDto })
  estimatedDelivery: EstimatedDeliveryDto;

  @ApiProperty({
    type: () => OrderShipmentDto,
    nullable: true,
    description: '`null` mientras la orden no tenga envío.',
  })
  shipment: OrderShipmentDto | null;

  @ApiProperty({ type: String, format: 'date-time' })
  placedAt: Date;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'Vencimiento de la reserva mientras la orden está en `PENDING_PAYMENT`; `null` en otros estados.',
  })
  paymentDueAt: Date | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  paidAt: Date | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  shippedAt: Date | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  deliveredAt: Date | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  cancelledAt: Date | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  expiredAt: Date | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  refundedAt: Date | null;
}

/** What `Order` and its summary share: the customer sees the method and status of the payment. */
export class OrderSummaryDto extends OrderFieldsDto {
  @ApiProperty({
    type: () => OrderPaymentDto,
    nullable: true,
    description: '`null` mientras la orden no tenga pago.',
  })
  payment: OrderPaymentDto | null;
}

/** `Order` of API_SPEC.md §8.8: the customer's view. */
export class OrderDto extends OrderSummaryDto {
  @ApiProperty({ type: () => [OrderLineDto] })
  lines: OrderLineDto[];

  @ApiProperty({ type: () => PostalAddressDto })
  shippingAddress: PostalAddressDto;
}

export class OrderListDto {
  @ApiProperty({ type: () => [OrderSummaryDto] })
  data: OrderSummaryDto[];

  @ApiProperty({ type: () => PageMetaDto })
  meta: PageMetaDto;
}

/** Query of `GET /v1/me/orders` (UC-ORD-03, API_SPEC.md §15.4). */
export class OrderListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    type: String,
    description: `Uno o más estados separados por comas: ${ORDER_STATUSES.map((status) => `\`${status}\``).join(', ')}.`,
    example: 'PENDING_PAYMENT,PAID',
  })
  @IsOptional()
  @CommaSeparated()
  @IsIn(ORDER_STATUSES, { each: true })
  status?: OrderStatus[];

  /** Fecha o fecha y hora ISO 8601; incluida. @example '2026-09-01' */
  @IsOptional()
  @IsISO8601({ strict: true })
  placedFrom?: string;

  /** Fecha o fecha y hora ISO 8601; incluida (una fecha sola incluye todo el día). @example '2026-09-30' */
  @IsOptional()
  @IsISO8601({ strict: true })
  placedTo?: string;

  /** `placedAt` o `grandTotal`, con `-` para orden descendente; por defecto `-placedAt`. */
  @IsOptional()
  @IsSortOf(['placedAt', 'grandTotal'])
  sort?: string;
}
