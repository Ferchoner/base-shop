import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  PageMetaDto,
  PageQueryDto,
} from '../../../platform/http/pagination/page-query.dto.js';
import { MAX_NOTE_LENGTH } from '../application/inventory-limits.js';
import {
  COUNT_CLASSES,
  COUNT_OUTCOMES,
  COUNT_STATUSES,
  type CountClass,
  type CountStatus,
  MAX_COUNT_LINES,
  MAX_COUNTED,
} from '../application/stock-counts.use-case.js';

// Plain string, number and boolean fields are documented by the Swagger plugin from their types and comments.
// Fields holding other DTOs, dates or null declare their type with @ApiProperty (DEVELOPMENT_GUIDE.md).

const DATE_TIME = { type: String, format: 'date-time' } as const;
const NULLABLE_TEXT = { type: String, nullable: true } as const;
const NULLABLE_INT = { type: Number, nullable: true } as const;

/** Request of `POST /v1/admin/inventory/counts` (ADR-0173). */
export class CreateCountDto {
  /** El almacén que se cuenta, en cualquier estado. */
  @IsUUID()
  warehouseId: string;

  /**
   * Una ubicación, o con `*` al final las que empiezan así; sin importar mayúsculas.
   * @example 'A*'
   */
  // Up to 100 before the spaces are trimmed; the domain checks the 20 that are kept.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  location?: string;

  /** Los productos que están directamente en esta categoría. */
  @IsOptional()
  @IsUUID('all')
  categoryId?: string;

  @ApiPropertyOptional({
    enum: COUNT_CLASSES,
    description:
      'Los productos de esta clase; `C` incluye a los que no tienen clase.',
  })
  @IsOptional()
  @IsIn(COUNT_CLASSES)
  countClass?: CountClass;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    description: `Exactamente estas variantes, de 1 a ${MAX_COUNT_LINES.toLocaleString('en-US')}, cada una una vez; sin otro filtro.`,
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_COUNT_LINES)
  @IsUUID('all', { each: true })
  variantIds?: string[];

  /** Hasta 500 caracteres. */
  @ApiPropertyOptional({ ...NULLABLE_TEXT, example: 'Conteo semanal clase A' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_NOTE_LENGTH)
  note?: string | null;
}

/** Request of `PUT …/counts/{countId}/lines/{variantId}` (ADR-0173). */
export class CountLineInputDto {
  /** Lo contado, de 0 a 100,000. @example 7 */
  @IsInt()
  @Min(0)
  @Max(MAX_COUNTED)
  counted: number;
}

/** Request of the actions on a sheet: recount a line, apply and cancel (ADR-0173). */
export class CountVersionDto {
  /** Versión leída de la hoja (bloqueo optimista). */
  @IsInt()
  @Min(1)
  version: number;
}

/** What a sheet was opened with. */
export class CountFilterDto {
  /** La ubicación o el prefijo con `*`, en mayúsculas. @example 'A*' */
  @ApiPropertyOptional()
  location?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  categoryId?: string;

  @ApiPropertyOptional({ enum: COUNT_CLASSES })
  countClass?: string;

  @ApiPropertyOptional({ type: [String], format: 'uuid' })
  variantIds?: string[];
}

/** A line of a sheet as the API answers it. */
export class CountLineDto {
  @ApiProperty({ format: 'uuid' })
  variantId: string;

  /** @example 'JUE-ZELDA-SW' */
  sku: string;

  /** @example 'The Legend of Zelda' */
  productTitle: string;

  /** Su orden en la hoja, desde 1. @example 1 */
  position: number;

  /** La ubicación de la existencia cuando se tomó la línea; `null` sin ella. */
  @ApiProperty({ ...NULLABLE_TEXT, example: 'A1' })
  location: string | null;

  @ApiProperty({
    ...NULLABLE_INT,
    description: 'Lo contado; `null` mientras no se cuenta.',
  })
  counted: number | null;

  @ApiProperty({
    ...NULLABLE_TEXT,
    format: 'uuid',
    description: 'La cuenta de staff que la contó.',
  })
  countedBy: string | null;

  @ApiProperty({ ...DATE_TIME, nullable: true })
  countedAt: Date | null;

  /** Se pidió volver a contarla. */
  recount: boolean;

  @ApiProperty({
    ...NULLABLE_INT,
    description:
      'Las físicas al contarla; `null` sin contar y en una hoja a ciegas (`blind`).',
  })
  expected: number | null;

  @ApiProperty({
    ...NULLABLE_INT,
    description:
      'Lo contado menos `expected`; `null` sin contar y en una hoja a ciegas.',
  })
  difference: number | null;

  @ApiProperty({
    enum: COUNT_OUTCOMES,
    nullable: true,
    description:
      'Lo que hizo aplicar la hoja: `ADJUSTED`, `NO_DIFFERENCE`, `NOT_COUNTED` o `SKIPPED_RESERVED` (dejaría menos físicas que las apartadas); `null` mientras está abierta.',
  })
  outcome: string | null;

  @ApiProperty({
    ...NULLABLE_TEXT,
    format: 'uuid',
    description: 'El ajuste `PHYSICAL_COUNT` de una línea `ADJUSTED`.',
  })
  movementId: string | null;
}

/** A sheet without its lines, as the listing answers it (ADR-0173). */
export class CountSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  /** El folio, consecutivo. @example 'C-000123' */
  folio: string;

  @ApiProperty({ format: 'uuid' })
  warehouseId: string;

  @ApiProperty({ type: () => CountFilterDto })
  filter: CountFilterDto;

  /** Nota del staff; `null` sin ella. */
  @ApiProperty(NULLABLE_TEXT)
  note: string | null;

  @ApiProperty({
    enum: COUNT_STATUSES,
    description:
      '`OPEN` mientras se cuenta; `APPLIED` o `CANCELLED` ya no cambia.',
  })
  status: string;

  /** Cuántas líneas tiene. @example 40 */
  lineCount: number;

  /** Cuántas están contadas. @example 12 */
  countedCount: number;

  @ApiProperty({
    format: 'uuid',
    description: 'La cuenta de staff que la abrió.',
  })
  createdBy: string;

  @ApiProperty(DATE_TIME)
  createdAt: Date;

  @ApiProperty({
    ...NULLABLE_TEXT,
    format: 'uuid',
    description: 'La cuenta de staff que la aplicó o la canceló.',
  })
  closedBy: string | null;

  @ApiProperty({ ...DATE_TIME, nullable: true })
  closedAt: Date | null;

  /** Versión para revisarla, aplicarla o cancelarla (bloqueo optimista). @example 3 */
  version: number;
}

/** `StockCount` of API_SPEC.md §13 (ADR-0173). */
export class CountDto extends CountSummaryDto {
  /** Sin `expected` ni `difference`: quien no tiene `inventory.write` cuenta a ciegas. */
  blind: boolean;

  @ApiProperty({
    type: () => [CountLineDto],
    description: 'En su orden en la hoja.',
  })
  lines: CountLineDto[];
}

export class CountListDto {
  @ApiProperty({
    type: () => [CountSummaryDto],
    description: 'De la más reciente a la más antigua.',
  })
  data: CountSummaryDto[];

  @ApiProperty({ type: () => PageMetaDto })
  meta: PageMetaDto;
}

/** Query of `GET /v1/admin/inventory/counts` (ADR-0173). */
export class CountListQueryDto extends PageQueryDto {
  /** Las hojas de este almacén. */
  @IsOptional()
  @IsUUID('all')
  warehouseId?: string;

  @ApiPropertyOptional({
    enum: COUNT_STATUSES,
    description: 'Las hojas en este estado.',
  })
  @IsOptional()
  @IsIn(COUNT_STATUSES)
  status?: CountStatus;
}
