import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
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
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  DATE_TIME_WITH_OFFSET,
  WITH_OFFSET,
} from '../../../platform/http/date-time.js';
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
  PROMOTION_CHANNELS,
  PROMOTION_LIMITS as LIMITS,
  PROMOTION_STATUSES,
  PROMOTION_TARGET_TYPES,
  type PromotionChannel,
  type PromotionStatus,
  type PromotionTargetType,
} from '../application/promotion-values.js';
import {
  PROMOTION_REACHES,
  type PromotionReach,
} from '../application/promotions.queries.js';

// Plain string, number and boolean fields are documented by the Swagger plugin from their types and comments;
// fields holding other DTOs, lists, dates, enums, objects or null declare their type with @ApiProperty
// (DEVELOPMENT_GUIDE.md).

const NOT_BLANK = { context: { message: 'No puede estar vacío.' } };

/** Required in a change: present, it cannot be `null`. */
const unlessMissing = (_: unknown, value: unknown) => value !== undefined;

/** A product, category or brand a promotion is limited to. */
export class PromotionTargetDto {
  @ApiProperty({
    enum: PROMOTION_TARGET_TYPES,
    description:
      '`PRODUCT`, `CATEGORY` (con sus subcategorías) o `BRAND`; debe existir y estar en uso.',
  })
  @IsIn(PROMOTION_TARGET_TYPES)
  type: PromotionTargetType;

  /** El ID del producto, la categoría o la marca. */
  @IsUUID('all')
  id: string;
}

/** The terms a new promotion and a change share (API_SPEC.md §26.2 and §26.5). */
class PromotionTermsDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: LIMITS.percentage,
    description:
      'Porcentaje entero de descuento, de 1 a 100, sobre las líneas a las que aplica. Exactamente uno de `percentage` y `amountOff`.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(LIMITS.percentage)
  percentage?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_MONEY_AMOUNT,
    description:
      'Monto fijo de descuento en centavos, una vez por orden, repartido entre las líneas a las que aplica. Exactamente uno de `percentage` y `amountOff`.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_MONEY_AMOUNT)
  amountOff?: number;
}

/** Request of `POST /v1/admin/promotions` (UC-PRM-01, API_SPEC.md §26.2). */
export class CreatePromotionDto extends PromotionTermsDto {
  /** Nombre de 1 a 120 caracteres; lo ve el cliente en su orden y en el ticket. @example 'Buen Fin 10%' */
  @IsString()
  @Length(1, LIMITS.name)
  @Matches(/\S/, NOT_BLANK)
  name: string;

  @ApiPropertyOptional({
    type: () => [PromotionTargetDto],
    description: `Hasta ${LIMITS.targets} productos, categorías (con sus subcategorías) y marcas, cada uno una vez; sin ellos, o vacío, aplica a toda la compra.`,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(LIMITS.targets)
  @ArrayUnique(
    (target: PromotionTargetDto) =>
      `${target?.type}:${target?.id?.toLowerCase()}`,
  )
  @ValidateNested({ each: true })
  @Type(() => PromotionTargetDto)
  targets?: PromotionTargetDto[];

  @ApiPropertyOptional({
    enum: PROMOTION_CHANNELS,
    isArray: true,
    description:
      'Dónde aplica: `ONLINE`, `STORE` o los dos; por defecto, los dos.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(PROMOTION_CHANNELS, { each: true })
  channels?: PromotionChannel[];

  @ApiPropertyOptional({
    nullable: true,
    minimum: 1,
    maximum: MAX_MONEY_AMOUNT,
    description:
      'Compra mínima en centavos, sobre el subtotal con IVA de la orden; `null` o ausente, sin mínimo.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_MONEY_AMOUNT)
  minimumSubtotal?: number | null;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-11-13T06:00:00.000Z',
    description:
      'Inicio, fecha y hora con zona horaria. Ausente o no posterior al momento actual: empieza ahora.',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(DATE_TIME_WITH_OFFSET, WITH_OFFSET)
  startsAt?: string | null;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-11-17T06:00:00.000Z',
    description:
      'Fin, excluido, fecha y hora con zona horaria, posterior al inicio; `null` o ausente, sin fin.',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(DATE_TIME_WITH_OFFSET, WITH_OFFSET)
  endsAt?: string | null;
}

/**
 * Request of `PATCH /v1/admin/promotions/{promotionId}` (UC-PRM-03, API_SPEC.md §26.5). Only the fields sent
 * change. Once started, only `name` and `endsAt`.
 */
export class UpdatePromotionDto extends PromotionTermsDto {
  /** Nombre de 1 a 120 caracteres. */
  @ValidateIf(unlessMissing)
  @IsString()
  @Length(1, LIMITS.name)
  @Matches(/\S/, NOT_BLANK)
  name?: string;

  @ApiPropertyOptional({
    type: () => [PromotionTargetDto],
    description: `Reemplaza la lista: hasta ${LIMITS.targets} productos, categorías y marcas; vacía, toda la compra.`,
  })
  @ValidateIf(unlessMissing)
  @IsArray()
  @ArrayMaxSize(LIMITS.targets)
  @ArrayUnique(
    (target: PromotionTargetDto) =>
      `${target?.type}:${target?.id?.toLowerCase()}`,
  )
  @ValidateNested({ each: true })
  @Type(() => PromotionTargetDto)
  targets?: PromotionTargetDto[];

  @ApiPropertyOptional({
    enum: PROMOTION_CHANNELS,
    isArray: true,
    description: 'Dónde aplica: `ONLINE`, `STORE` o los dos.',
  })
  @ValidateIf(unlessMissing)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(PROMOTION_CHANNELS, { each: true })
  channels?: PromotionChannel[];

  @ApiPropertyOptional({
    nullable: true,
    minimum: 1,
    maximum: MAX_MONEY_AMOUNT,
    description: 'Compra mínima en centavos; `null` la quita.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_MONEY_AMOUNT)
  minimumSubtotal?: number | null;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description:
      'Inicio, fecha y hora con zona horaria; no posterior al momento actual, empieza ahora.',
  })
  @ValidateIf(unlessMissing)
  @IsISO8601({ strict: true })
  @Matches(DATE_TIME_WITH_OFFSET, WITH_OFFSET)
  startsAt?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'Fin, excluido, posterior al inicio y, ya iniciada, al momento actual; `null` lo quita.',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(DATE_TIME_WITH_OFFSET, WITH_OFFSET)
  endsAt?: string | null;

  /** Versión leída (bloqueo optimista). */
  @IsInt()
  @Min(1)
  version: number;
}

/** Request of `POST /v1/admin/promotions/{promotionId}/end` (UC-PRM-03, API_SPEC.md §26.6). */
export class EndPromotionDto {
  /** Versión leída (bloqueo optimista). */
  @IsInt()
  @Min(1)
  version: number;
}

/** Query of `GET /v1/admin/promotions` (UC-PRM-02, API_SPEC.md §26.3). */
export class PromotionListQueryDto extends PageQueryDto {
  /** Parte del nombre, sin distinguir mayúsculas. */
  @IsOptional()
  @IsString()
  @MaxLength(254)
  q?: string;

  @ApiPropertyOptional({
    type: String,
    description: `Uno o más estados separados por comas, al momento de la consulta: ${PROMOTION_STATUSES.map((status) => `\`${status}\``).join(', ')}.`,
    example: 'SCHEDULED,ACTIVE',
  })
  @IsOptional()
  @CommaSeparated()
  @IsIn(PROMOTION_STATUSES, { each: true })
  status?: PromotionStatus[];

  @ApiPropertyOptional({
    enum: PROMOTION_CHANNELS,
    description: 'Las que aplican en este canal.',
  })
  @IsOptional()
  @IsIn(PROMOTION_CHANNELS)
  channel?: PromotionChannel;

  @ApiPropertyOptional({
    enum: PROMOTION_REACHES,
    description:
      '`ORDER`: las de toda la compra. `ITEMS`: las de ciertos productos, categorías o marcas.',
  })
  @IsOptional()
  @IsIn(PROMOTION_REACHES)
  appliesTo?: PromotionReach;

  /** `startsAt` o `name`, con `-` para orden descendente; por defecto `-startsAt`. */
  @IsOptional()
  @IsSortOf(['startsAt', 'name'])
  sort?: string;
}

/** A target of a promotion, with its name as Catalog gives it now. */
export class PromotionTargetViewDto {
  @ApiProperty({ enum: PROMOTION_TARGET_TYPES })
  type: PromotionTargetType;

  @ApiProperty({ type: String, format: 'uuid' })
  id: string;

  @ApiProperty({
    nullable: true,
    description:
      'El título del producto, o el nombre de la categoría o la marca; `null` si el catálogo ya no lo tiene.',
  })
  name: string | null;
}

/** Shared fields of a promotion in a list and alone. */
export class PromotionSummaryDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id: string;

  /** Lo ve el cliente en su orden y en el ticket. */
  name: string;

  @ApiProperty({
    enum: PROMOTION_STATUSES,
    description:
      'Al momento de la consulta: `SCHEDULED` antes de su inicio, `ACTIVE` hasta su fin, `ENDED` desde entonces o desde que se terminó.',
  })
  status: PromotionStatus;

  @ApiProperty({
    nullable: true,
    description: 'Porcentaje entero de descuento; `null` con `amountOff`.',
  })
  percentage: number | null;

  @ApiProperty({
    type: () => MoneyDto,
    nullable: true,
    description:
      'Monto fijo de descuento, una vez por orden; `null` con `percentage`.',
  })
  amountOff: MoneyDto | null;

  /** Cuántos productos, categorías y marcas tiene; 0 aplica a toda la compra. */
  targetCount: number;

  @ApiProperty({ enum: PROMOTION_CHANNELS, isArray: true })
  channels: PromotionChannel[];

  @ApiProperty({
    type: () => MoneyDto,
    nullable: true,
    description: 'Compra mínima sobre el subtotal con IVA; `null` sin mínimo.',
  })
  minimumSubtotal: MoneyDto | null;

  @ApiProperty({ type: String, format: 'date-time' })
  startsAt: Date;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Fin, excluido; `null` sin fin.',
  })
  endsAt: Date | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Cuándo se terminó a mano.',
  })
  endedAt: Date | null;
}

/** `Promotion` (API_SPEC.md §26.1). */
export class PromotionDto extends PromotionSummaryDto {
  @ApiProperty({
    type: () => [PromotionTargetViewDto],
    description:
      'Productos, luego categorías, luego marcas; vacía, aplica a toda la compra.',
  })
  targets: PromotionTargetViewDto[];

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description: 'La cuenta de staff que la terminó.',
  })
  endedBy: string | null;

  /** La cuenta de staff que la creó. */
  @ApiProperty({ type: String, format: 'uuid' })
  createdBy: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: Date;

  /** Para el bloqueo optimista. */
  version: number;
}

export class PromotionListDto {
  @ApiProperty({ type: () => [PromotionSummaryDto] })
  data: PromotionSummaryDto[];

  @ApiProperty({ type: () => PageMetaDto })
  meta: PageMetaDto;
}
