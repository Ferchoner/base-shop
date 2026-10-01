import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { CommaSeparated } from '../../../platform/http/pagination/pagination.js';
import { MoneyDto } from '../../../platform/http/money.dto.js';
import { MAX_MONEY_AMOUNT } from '../../../shared-kernel/index.js';
import {
  PRICE_PERIOD_STATES,
  type PricePeriodState,
} from '../application/pricing.queries.js';

// Plain string, number and boolean fields are documented by the Swagger plugin from their types and comments.
// Fields holding other DTOs, dates or null declare their type with @ApiProperty (DEVELOPMENT_GUIDE.md).

/** A date and time with its offset, so the instant never depends on the server's time zone. */
const DATE_TIME_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

/** `PriceList` of API_SPEC.md §12. */
export class PriceListDto {
  id: string;

  /** @example 'GENERAL' */
  code: string;

  /** @example 'Lista general' */
  name: string;

  @ApiProperty({ enum: ['MXN'], example: 'MXN' })
  currency: string;

  /** @example 0 */
  priority: number;

  isDefault: boolean;

  /** Los montos incluyen IVA (ADR-0008). */
  taxesIncluded: boolean;

  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'] })
  status: string;
}

export class PriceListListDto {
  @ApiProperty({ type: () => [PriceListDto] })
  data: PriceListDto[];
}

/** `PricePeriod` of API_SPEC.md §12. */
export class PricePeriodDto {
  id: string;

  @ApiProperty({ type: () => MoneyDto, description: 'Con IVA incluido.' })
  amount: MoneyDto;

  @ApiProperty({
    type: () => MoneyDto,
    nullable: true,
    description: 'Precio "antes", mayor que `amount`; `null` si no hay.',
  })
  compareAtAmount: MoneyDto | null;

  @ApiProperty({ type: String, format: 'date-time' })
  effectiveFrom: Date;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'Donde empieza el periodo siguiente; `null` mientras no haya uno posterior.',
  })
  effectiveTo: Date | null;

  @ApiProperty({ enum: PRICE_PERIOD_STATES })
  state: string;

  /** Staff que lo creó. */
  createdBy: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;
}

export class PricePeriodListDto {
  @ApiProperty({
    type: () => [PricePeriodDto],
    description: 'Del inicio más reciente al más antiguo.',
  })
  data: PricePeriodDto[];

  @ApiProperty({
    type: () => PricePeriodDto,
    nullable: true,
    description: 'El periodo vigente, aunque `state` lo deje fuera de `data`.',
  })
  current: PricePeriodDto | null;
}

/** Query of `GET …/variants/{variantId}/periods`. */
export class PricePeriodQueryDto {
  @ApiPropertyOptional({
    type: String,
    description:
      'Uno o más estados separados por comas: `PAST`, `CURRENT`, `SCHEDULED`.',
    example: 'CURRENT,SCHEDULED',
  })
  @IsOptional()
  @CommaSeparated()
  @IsIn(PRICE_PERIOD_STATES, { each: true })
  state?: PricePeriodState[];
}

/** `POST …/variants/{variantId}/periods` (UC-PRC-02, UC-PRC-03). Amounts in cents, VAT included. */
export class SetPriceDto {
  /**
   * Centavos, con IVA incluido.
   * @example 59900
   */
  @IsInt()
  @Min(0)
  @Max(MAX_MONEY_AMOUNT)
  amount: number;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    example: 79900,
    description: 'Precio "antes" en centavos, mayor que `amount`.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_MONEY_AMOUNT)
  compareAtAmount?: number | null;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-11-14T06:00:00.000Z',
    description:
      'Fecha y hora con zona horaria. Ausente o no posterior al momento actual: precio desde ahora. Futura: precio programado.',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(DATE_TIME_WITH_OFFSET, {
    context: { message: 'Debe ser fecha y hora con zona horaria.' },
  })
  effectiveFrom?: string | null;
}

/** Query of `POST …/price-lists/{priceListId}/imports` (UC-PRC-05). */
export class PriceImportQueryDto {
  /** Valida el archivo y responde el resumen sin guardar nada. */
  @ApiPropertyOptional({ type: Boolean, default: false })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  dryRun?: boolean;
}

/** What a bulk import did, or would do with `dryRun` (ADR-0126). */
export class PriceImportSummaryDto {
  /** Filas del archivo, sin el encabezado. */
  rows: number;

  /** Periodos abiertos o programados. */
  created: number;

  /** Filas iguales al precio vigente, o a uno ya programado en el mismo instante. */
  unchanged: number;

  dryRun: boolean;
}
