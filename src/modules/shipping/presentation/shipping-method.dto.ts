import { ApiProperty } from '@nestjs/swagger';
import {
  IsDefined,
  IsInt,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { MoneyDto } from '../../../platform/http/money.dto.js';
import { MAX_MONEY_AMOUNT } from '../../../shared-kernel/index.js';
import {
  MAX_DELIVERY_BUSINESS_DAYS,
  MAX_NAME_LENGTH,
} from '../application/shipping-limits.js';

// Plain string, number and boolean fields are documented by the Swagger plugin from their types and comments.
// Fields holding other DTOs, dates or null declare their type with @ApiProperty (DEVELOPMENT_GUIDE.md).

const NOT_BLANK = { context: { message: 'No puede estar vacío.' } };

/** `ShippingMethod` of API_SPEC.md §17. */
export class ShippingMethodDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  /**
   * Solo lo ve el staff.
   * @example 'Envío Estándar'
   */
  name: string;

  @ApiProperty({
    type: () => MoneyDto,
    description: 'Costo fijo por orden, con IVA incluido (ADR-0079).',
  })
  flatFee: MoneyDto;

  @ApiProperty({
    type: () => MoneyDto,
    nullable: true,
    description:
      'Envío gratis cuando el subtotal con IVA menos el descuento lo alcanza; `null` si no hay envío gratis.',
  })
  freeShippingThreshold: MoneyDto | null;

  /**
   * Plazo de entrega estimado, en días hábiles desde la confirmación del pago (ADR-0083).
   * @example 3
   */
  deliveryMinBusinessDays: number;

  /**
   * Plazo máximo de entrega, en días hábiles desde la confirmación del pago.
   * @example 7
   */
  deliveryMaxBusinessDays: number;

  /** Si se usa; en el MVP, el único método está activo. */
  isActive: boolean;

  /** Versión para el bloqueo optimista: se envía al cambiarlo. */
  version: number;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: Date;
}

/** `PUT /v1/admin/shipping/method` (UC-SHI-02): replaces every setting. Amounts in cents. */
export class UpdateShippingMethodDto {
  /**
   * De 1 a 100 caracteres; solo lo ve el staff.
   * @example 'Envío Estándar'
   */
  @IsString()
  @Length(1, MAX_NAME_LENGTH)
  @Matches(/\S/, NOT_BLANK)
  name: string;

  /**
   * Costo fijo en centavos, con IVA incluido; 0 para envío siempre gratis.
   * @example 9900
   */
  @IsInt()
  @Min(0)
  @Max(MAX_MONEY_AMOUNT)
  flatFee: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 150000,
    description:
      'Umbral de envío gratis en centavos, mayor que 0; `null` para cobrar siempre el costo fijo.',
  })
  @IsDefined()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(MAX_MONEY_AMOUNT)
  freeShippingThreshold: number | null;

  /**
   * Días hábiles, de 1 a 30.
   * @example 3
   */
  @IsInt()
  @Min(1)
  @Max(MAX_DELIVERY_BUSINESS_DAYS)
  deliveryMinBusinessDays: number;

  /**
   * Días hábiles, de 1 a 30, y al menos `deliveryMinBusinessDays`.
   * @example 7
   */
  @IsInt()
  @Min(1)
  @Max(MAX_DELIVERY_BUSINESS_DAYS)
  deliveryMaxBusinessDays: number;

  /** Versión leída (bloqueo optimista). */
  @IsInt()
  @Min(1)
  version: number;
}
