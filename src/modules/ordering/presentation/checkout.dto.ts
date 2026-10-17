import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { MoneyDto } from '../../../platform/http/money.dto.js';

// Plain string, number and boolean fields are documented by the Swagger plugin from their types and comments;
// fields holding other DTOs, lists, dates, enums, objects or null declare their type with @ApiProperty
// (DEVELOPMENT_GUIDE.md).

/** Request of `POST /v1/checkout/quote` (UC-ORD-01, API_SPEC.md §15.2). */
export class GuestQuoteDto {
  /** El `cartId` del carrito de invitado. */
  @IsUUID('all')
  cartId: string;
}

/** Plazo de entrega estimado en días hábiles desde la confirmación del pago (ADR-0083). */
export class EstimatedDeliveryDto {
  /**
   * Días hábiles mínimos desde la confirmación del pago.
   * @example 3
   */
  minBusinessDays: number;

  /**
   * Días hábiles máximos desde la confirmación del pago.
   * @example 7
   */
  maxBusinessDays: number;
}

/** A line of `CheckoutQuote` (API_SPEC.md §8.7). */
export class CheckoutQuoteLineDto {
  @ApiProperty({ format: 'uuid' })
  variantId: string;

  /** @example 2 */
  quantity: number;

  /** @example 'CAM-LIN-AZ-M' */
  sku: string;

  /** @example 'Camisa de lino' */
  productTitle: string;

  /** Los valores de las opciones de la variante, por nombre. */
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    example: { talla: 'M' },
  })
  options: Record<string, string>;

  /** Precio vigente, con IVA; `null` si la línea no es vendible. */
  @ApiProperty({ type: () => MoneyDto, nullable: true })
  unitPrice: MoneyDto | null;

  /** Precio por cantidad, antes del descuento; `null` si la línea no es vendible, y entonces no suma. */
  @ApiProperty({ type: () => MoneyDto, nullable: true })
  lineTotal: MoneyDto | null;

  @ApiProperty({
    type: () => MoneyDto,
    nullable: true,
    description:
      'Lo que la promoción de la cotización quita a la línea, 0 sin ella (ADR-0168); `null` si la línea no es vendible.',
  })
  discountAmount: MoneyDto | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 1600,
    description: 'Tasa de IVA en puntos base.',
  })
  taxRateBp: number | null;

  @ApiProperty({
    type: () => MoneyDto,
    nullable: true,
    description:
      'IVA contenido en `lineTotal` menos `discountAmount`, redondeado por línea (ADR-0168).',
  })
  taxAmount: MoneyDto | null;

  /** Producto publicado, variante activa y precio vigente (BR-PRD-11). */
  sellable: boolean;

  /** Si la cantidad pedida puede surtirse, sin revelar existencias (ADR-0061). */
  canFulfill: boolean;
}

/** The promotion of the discount of a quote or an order (ADR-0168), with the name the customer sees. */
export class AppliedPromotionDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id: string;

  /** El nombre de la promoción, como lo ve el cliente. @example 'Buen Fin 10%' */
  name: string;
}

/** `CheckoutQuote` of API_SPEC.md §8.7. */
export class CheckoutQuoteDto {
  /** Las líneas del carrito, también las que no se pueden comprar, marcadas. */
  @ApiProperty({ type: () => [CheckoutQuoteLineDto] })
  lines: CheckoutQuoteLineDto[];

  @ApiProperty({
    type: () => MoneyDto,
    description: 'Líneas vendibles, con IVA incluido.',
  })
  subtotal: MoneyDto;

  @ApiProperty({
    type: () => MoneyDto,
    description:
      'Informativo: IVA contenido en el subtotal y en el costo de envío.',
  })
  taxTotal: MoneyDto;

  @ApiProperty({
    type: () => MoneyDto,
    description: 'Con IVA incluido; 0 desde `freeShippingThreshold`.',
  })
  shippingCost: MoneyDto;

  /** IVA contenido en `shippingCost`. */
  @ApiProperty({ type: () => MoneyDto })
  shippingTaxAmount: MoneyDto;

  @ApiProperty({
    type: () => MoneyDto,
    description:
      'Lo que la promoción quita a las líneas vendibles, la suma de sus `discountAmount`; 0 sin promoción (ADR-0168).',
  })
  discountTotal: MoneyDto;

  @ApiProperty({
    type: () => AppliedPromotionDto,
    nullable: true,
    description:
      'La promoción automática que más descuenta, en este canal y en este momento; `null` si ninguna quita algo (ADR-0168).',
  })
  promotion: AppliedPromotionDto | null;

  @ApiProperty({
    type: () => MoneyDto,
    description: 'Su `amount` es el `expectedTotal` para colocar la orden.',
  })
  grandTotal: MoneyDto;

  @ApiProperty({
    type: () => MoneyDto,
    nullable: true,
    description: '`null` si nunca hay envío gratis.',
  })
  freeShippingThreshold: MoneyDto | null;

  @ApiProperty({
    type: () => EstimatedDeliveryDto,
    nullable: true,
    description:
      'Plazo estimado de entrega, desde la confirmación del pago (ADR-0083); `null` en una cotización del staff con `fulfillment` `IN_STORE` (ADR-0161).',
  })
  estimatedDelivery: EstimatedDeliveryDto | null;

  /** Todas las líneas son vendibles y surtibles. */
  readyToPlace: boolean;
}
