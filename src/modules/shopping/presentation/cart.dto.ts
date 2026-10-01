import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsUUID, Max, Min } from 'class-validator';
import { MoneyDto } from '../../../platform/http/money.dto.js';
import { MAX_LINE_QUANTITY } from '../application/cart-limits.js';

// Plain string, number and boolean fields are documented by the Swagger plugin from their types and comments;
// fields holding other DTOs, lists, dates, enums, objects or null declare their type with @ApiProperty
// (DEVELOPMENT_GUIDE.md).

/** Request of `POST …/lines` (UC-CRT-02, API_SPEC.md §14.2). */
export class AddCartLineDto {
  @IsUUID('all')
  variantId: string;

  /**
   * Unidades a sumar; la línea queda con 30 como máximo (BR-CRT-02).
   * @example 1
   */
  @IsInt()
  @Min(1)
  @Max(MAX_LINE_QUANTITY)
  quantity: number;
}

/** Request of `PATCH …/lines/{variantId}` (UC-CRT-03). */
export class ChangeCartLineDto {
  /**
   * Unidades de la línea, de 1 a 30.
   * @example 2
   */
  @IsInt()
  @Min(1)
  @Max(MAX_LINE_QUANTITY)
  quantity: number;
}

/** Request of `POST /v1/me/cart/merge` (UC-CRT-06, ADR-0059). */
export class MergeCartDto {
  /** El `cartId` del carrito de invitado. */
  @IsUUID('all')
  guestCartId: string;
}

export class CartProductDto {
  id: string;

  /** @example 'camisa-lino-azul' */
  slug: string;

  /** @example 'Camisa de lino' */
  title: string;
}

/** `Image` of API_SPEC.md §8.3: la imagen principal de la variante o, si no tiene, la del producto. */
export class CartImageDto {
  id: string;

  url: string;

  @ApiProperty({ type: String, nullable: true })
  altText: string | null;

  position: number;

  @ApiProperty({ type: String, nullable: true })
  variantId: string | null;
}

/** A line of `Cart` (API_SPEC.md §8.6). */
export class CartLineDto {
  variantId: string;

  /** @example 2 */
  quantity: number;

  @ApiProperty({ type: () => CartProductDto })
  product: CartProductDto;

  /** @example 'CAM-LIN-AZ-M' */
  sku: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    example: { talla: 'M' },
  })
  options: Record<string, string>;

  @ApiProperty({ type: () => CartImageDto, nullable: true })
  image: CartImageDto | null;

  /** Producto publicado, variante activa y precio vigente (BR-PRD-11). */
  sellable: boolean;

  /** Si la cantidad pedida puede surtirse, sin revelar existencias (ADR-0061). */
  canFulfill: boolean;

  @ApiProperty({ type: () => MoneyDto, nullable: true })
  unitPrice: MoneyDto | null;

  @ApiProperty({ type: () => MoneyDto, nullable: true })
  lineTotal: MoneyDto | null;
}

/** `Cart` of API_SPEC.md §8.6. */
export class CartDto {
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      '`null` en `GET /v1/me/cart` cuando el cliente aún no tiene carrito.',
  })
  id: string | null;

  @ApiProperty({ enum: ['ACTIVE', 'CHECKED_OUT', 'MERGED'] })
  status: string;

  @ApiProperty({ type: () => [CartLineDto] })
  lines: CartLineDto[];

  /** Unidades de todas las líneas. */
  itemCount: number;

  /** Líneas vendibles, con IVA incluido. */
  @ApiProperty({ type: () => MoneyDto })
  subtotal: MoneyDto;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastActivityAt: Date | null;
}
