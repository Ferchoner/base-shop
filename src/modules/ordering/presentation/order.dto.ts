import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
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
  PAYMENT_METHODS,
  type PaymentMethod,
} from '../application/payment-ports.js';
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
  ORDER_FULFILLMENTS,
  ORDER_STATUSES,
  type OrderFulfillment,
  type OrderStatus,
} from '../application/order-values.js';
import { EstimatedDeliveryDto } from './checkout.dto.js';

// Plain string, number and boolean fields are documented by the Swagger plugin from their types and comments;
// fields holding other DTOs, lists, dates, enums, objects or null declare their type with @ApiProperty
// (DEVELOPMENT_GUIDE.md).

const NOT_BLANK = { context: { message: 'No puede estar vacío.' } };

/** Emails are compared in lowercase and without surrounding spaces, as in Identity (BR-USR-01). */
export const toNormalizedEmail = ({ value }: { value: unknown }) =>
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

  /** La dirección de envío, con el formato de `AddressInput`. */
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
 * Request of `POST /v1/orders/lookup` (UC-ORD-04, API_SPEC.md §15.5): in the body, so the email and the code stay
 * out of logs and histories (ADR-0071). A code that cannot exist is answered as a missing order (ADR-0138).
 */
export class GuestOrderLookupDto {
  /**
   * Email de contacto de la orden, sin distinguir mayúsculas y minúsculas.
   * @example 'cliente@example.com'
   */
  @Transform(toNormalizedEmail)
  @IsEmail()
  @MaxLength(254)
  contactEmail: string;

  /**
   * Código público de la orden, con o sin guion y sin distinguir mayúsculas y minúsculas.
   * @example 'K7M4-Q9XA'
   */
  @IsString()
  @Length(1, 100)
  @Matches(/\S/, NOT_BLANK)
  publicCode: string;
}

/**
 * Request of `POST /v1/orders/reorder` (UC-CRT-09, API_SPEC.md §14.3): the guest is found as in the lookup
 * (ADR-0138), and the lines go into the active guest cart given, or a new one.
 */
export class GuestReorderDto extends GuestOrderLookupDto {
  /** Carrito de invitado activo que recibe las líneas; sin él se crea uno. */
  @IsOptional()
  @IsUUID('all')
  cartId?: string;
}

/**
 * Request of `POST /v1/orders/access-links` (UC-ORD-05, API_SPEC.md §15.6): the email alone, in the body so it stays
 * out of logs and histories (ADR-0071, ADR-0148).
 */
export class OrderAccessLinkRequestDto {
  /**
   * Email de contacto de las órdenes de invitado, sin distinguir mayúsculas y minúsculas.
   * @example 'cliente@example.com'
   */
  @Transform(toNormalizedEmail)
  @IsEmail()
  @MaxLength(254)
  contactEmail: string;
}

/** Request of `POST /v1/orders/access` (UC-ORD-05, API_SPEC.md §15.6). */
export class OrderAccessRequestDto {
  /**
   * El token del parámetro `token` del enlace: 43 caracteres en base64url.
   * @example 'q8Xz3Lr0VbN7kT2mWc9YhD4sFj6Ae1Pu5Gi8Ko0RnSv'
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  token: string;
}

/** Answer of the three reorder routes (UC-CRT-09, ADR-0139): read the cart with the routes of the cart. */
export class ReorderDto {
  /** El carrito que recibió las líneas. */
  @ApiProperty({ format: 'uuid' })
  cartId: string;

  @ApiProperty({
    type: [String],
    description: 'Variantes de la orden que ya no se venden y no se copiaron.',
  })
  skippedVariantIds: string[];
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
  /**
   * Número de la línea en la orden, desde 1.
   * @example 1
   */
  lineNumber: number;

  /** @example 'CAM-LIN-AZ-M' */
  sku: string;

  /**
   * El nombre del producto al colocar la orden.
   * @example 'Camisa de lino'
   */
  productName: string;

  /** Las opciones de la variante al colocar la orden. */
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    example: { talla: 'M' },
  })
  variantOptions: Record<string, string>;

  /** Precio con IVA al colocar la orden; no cambia aunque cambie el precio. */
  @ApiProperty({ type: () => MoneyDto })
  unitPrice: MoneyDto;

  /** @example 2 */
  quantity: number;

  /** Tasa de IVA en puntos base. @example 1600 */
  taxRateBp: number;

  /** IVA contenido en `lineTotal`. */
  @ApiProperty({ type: () => MoneyDto })
  taxAmount: MoneyDto;

  /** Precio por cantidad, con IVA. */
  @ApiProperty({ type: () => MoneyDto })
  lineTotal: MoneyDto;
}

/** The payment of an order, as the customer sees it (T-190). */
export class OrderPaymentDto {
  /** `MANUAL` es el pago en la tienda (ADR-0055); PayPal aún no está habilitado (ADR-0040). */
  @ApiProperty({ enum: ['MANUAL', 'PAYPAL'] })
  provider: string;

  /**
   * Estado del pago: `PENDING` mientras no se paga, `CAPTURED` al cobrarse, y `PARTIALLY_REFUNDED` o `REFUNDED` según
   * sus reembolsos.
   */
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
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: () => MoneyDto })
  amount: MoneyDto;

  /** `PENDING` hasta que el dinero se devuelve; `COMPLETED` o `FAILED` después. */
  @ApiProperty({ enum: ['PENDING', 'COMPLETED', 'FAILED'] })
  status: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  /** Cuándo se completó; `null` si no se ha completado. */
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  completedAt: Date | null;
}

/** The payment of an order, as the staff sees it (API_SPEC.md §8.9). */
export class AdminOrderPaymentDto extends OrderPaymentDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: () => MoneyDto, description: 'El total de la orden.' })
  amount: MoneyDto;

  /** Lo cobrado; 0 mientras no se cobra. */
  @ApiProperty({ type: () => MoneyDto })
  capturedAmount: MoneyDto;

  /** Lo reembolsado hasta ahora, de los reembolsos completados. */
  @ApiProperty({ type: () => MoneyDto })
  refundedAmount: MoneyDto;

  /** Cuándo se cobró; `null` si no se ha cobrado. */
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  capturedAt: Date | null;

  @ApiProperty({
    enum: PAYMENT_METHODS,
    nullable: true,
    description:
      'Cómo cobró la tienda un pago manual: `CASH`, `CARD_TERMINAL` o `TRANSFER` (ADR-0161); `null` si no se ha cobrado así, o si el staff no lo dijo.',
  })
  method: PaymentMethod | null;

  /** Sus reembolsos, del más antiguo al más reciente. */
  @ApiProperty({ type: () => [OrderRefundDto] })
  refunds: OrderRefundDto[];
}

/** The shipment of an order, as the customer sees it (T-195). */
export class OrderShipmentDto {
  /**
   * `PENDING` hasta que sale; luego `DISPATCHED`, y `DELIVERED`, `DELIVERY_FAILED` o `RETURNED`. `CANCELLED` si se
   * canceló la orden antes de salir.
   */
  @ApiProperty({
    enum: [
      'PENDING',
      'DISPATCHED',
      'DELIVERED',
      'DELIVERY_FAILED',
      'RETURNED',
      'CANCELLED',
    ],
  })
  status: string;

  /** La paquetería; `null` mientras no se capture o en una entrega de la tienda. */
  @ApiProperty({ type: String, nullable: true })
  carrierName: string | null;

  /** El número de guía; `null` mientras no se capture o en una entrega de la tienda. */
  @ApiProperty({ type: String, nullable: true })
  trackingNumber: string | null;

  /** Si lo entrega la tienda, sin paquetería (ADR-0078). */
  ownDelivery: boolean;

  /** Cuándo salió; `null` si no ha ocurrido. */
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  dispatchedAt: Date | null;

  /** Cuándo se entregó; `null` si no ha ocurrido. */
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  deliveredAt: Date | null;
}

/** The shipment of an order, as the staff sees it (API_SPEC.md §8.9, ADR-0140). */
export class AdminOrderShipmentDto extends OrderShipmentDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  /** El almacén del que sale: el de la reserva del pedido (ADR-0160). */
  @ApiProperty({ format: 'uuid' })
  warehouseId: string;

  /** Versión para el bloqueo optimista. */
  version: number;
}

/**
 * What every view of an order shares (API_SPEC.md §8.8): each adds its own `payment` and `shipment`. Never the
 * internal number nor the ID for a customer (ADR-0049).
 */
export class OrderFieldsDto {
  /**
   * Código público: con él y el email, quien compra consulta su pedido.
   * @example 'K7M4-Q9XA'
   */
  publicCode: string;

  /**
   * `PENDING_PAYMENT` espera su pago hasta `paymentDueAt`, y si no llega pasa a `EXPIRED`.
   * `AWAITING_MANUAL_FULFILLMENT` se pagó sin stock suficiente y espera surtido (ADR-0012). `REFUNDED`, cancelada y
   * reembolsada.
   */
  @ApiProperty({ enum: ORDER_STATUSES })
  status: OrderStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'cliente@example.com',
    description:
      '`null` en una orden anonimizada (ADR-0067) o bloqueada (ADR-0151), y en una venta de mostrador sin datos del comprador (ADR-0161).',
  })
  contactEmail: string | null;

  /** Unidades de todas las líneas. */
  itemCount: number;

  /** Suma de las líneas, con IVA. */
  @ApiProperty({ type: () => MoneyDto })
  subtotal: MoneyDto;

  /** Informativo: IVA contenido en el subtotal y en el envío. */
  @ApiProperty({ type: () => MoneyDto })
  taxTotal: MoneyDto;

  /** Con IVA; 0 con envío gratis. */
  @ApiProperty({ type: () => MoneyDto })
  shippingCost: MoneyDto;

  /** IVA contenido en `shippingCost`. */
  @ApiProperty({ type: () => MoneyDto })
  shippingTaxAmount: MoneyDto;

  /** Siempre 0 en el MVP. */
  @ApiProperty({ type: () => MoneyDto })
  discountTotal: MoneyDto;

  /** El total por pagar: subtotal más envío menos descuento. */
  @ApiProperty({ type: () => MoneyDto })
  grandTotal: MoneyDto;

  @ApiProperty({
    enum: ORDER_FULFILLMENTS,
    description:
      '`SHIPPING`: se envía a su dirección. `IN_STORE`: el staff la entrega en la tienda física al pagarse, sin dirección, sin costo de envío y sin plazo de entrega (ADR-0161).',
  })
  fulfillment: OrderFulfillment;

  @ApiProperty({
    type: () => EstimatedDeliveryDto,
    nullable: true,
    description:
      'Plazo estimado de entrega, desde la confirmación del pago (ADR-0083); `null` en una orden `IN_STORE`.',
  })
  estimatedDelivery: EstimatedDeliveryDto | null;

  /** Cuándo se colocó. */
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

  /** Cuándo se pagó; `null` si no ha ocurrido. */
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  paidAt: Date | null;

  /** Cuándo salió su envío; `null` si no ha ocurrido. */
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  shippedAt: Date | null;

  /** Cuándo se entregó; `null` si no ha ocurrido. */
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  deliveredAt: Date | null;

  /** Cuándo se canceló; `null` si no ha ocurrido. */
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  cancelledAt: Date | null;

  /** Cuándo venció sin pago; `null` si no ha ocurrido. */
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  expiredAt: Date | null;

  /** Cuándo se completó su reembolso; `null` si no ha ocurrido. */
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  refundedAt: Date | null;
}

/**
 * What `Order` and its summary share: the customer sees the method and status of the payment, and the shipment
 * without its ID nor its version.
 */
export class OrderSummaryDto extends OrderFieldsDto {
  @ApiProperty({
    type: () => OrderPaymentDto,
    nullable: true,
    description: '`null` mientras la orden no tenga pago.',
  })
  payment: OrderPaymentDto | null;

  @ApiProperty({
    type: () => OrderShipmentDto,
    nullable: true,
    description: '`null` mientras la orden no tenga envío.',
  })
  shipment: OrderShipmentDto | null;
}

/** `Order` of API_SPEC.md §8.8: the customer's view. */
export class OrderDto extends OrderSummaryDto {
  /** En el orden en que se colocaron. */
  @ApiProperty({ type: () => [OrderLineDto] })
  lines: OrderLineDto[];

  @ApiProperty({
    type: () => PostalAddressDto,
    nullable: true,
    description:
      'La dirección de envío al colocar la orden; `null` en una orden `IN_STORE`, que se entrega en la tienda (ADR-0161).',
  })
  shippingAddress: PostalAddressDto | null;
}

export class OrderListDto {
  @ApiProperty({ type: () => [OrderSummaryDto] })
  data: OrderSummaryDto[];

  @ApiProperty({ type: () => PageMetaDto })
  meta: PageMetaDto;
}

/** Answer of `POST /v1/orders/access` (UC-ORD-05, API_SPEC.md §15.6): the guest orders of the email of the link. */
export class OrderAccessDto {
  /**
   * El email del enlace, para consultar el detalle de cada orden con su código.
   * @example 'cliente@example.com'
   */
  contactEmail: string;

  @ApiProperty({
    type: () => [OrderSummaryDto],
    description:
      'Las 50 órdenes de invitado más recientes del email, de la más nueva a la más antigua, sin líneas ni dirección.',
  })
  orders: OrderSummaryDto[];
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
