import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  PageMetaDto,
  PageQueryDto,
} from '../../../platform/http/pagination/page-query.dto.js';
import {
  MAX_NOTE_LENGTH,
  MAX_STOCK_QUANTITY,
} from '../application/inventory-limits.js';
import {
  MAX_TRANSFER_LINES,
  REQUESTED_TRANSFER_REASONS,
  TRANSFER_KINDS,
  TRANSFER_REASONS,
  TRANSFER_STATUSES,
  type TransferKind,
  type TransferReason,
  type TransferStatus,
} from '../application/stock-transfers.use-case.js';

// Plain string, number and boolean fields are documented by the Swagger plugin from their types and comments.
// Fields holding other DTOs, dates or null declare their type with @ApiProperty (DEVELOPMENT_GUIDE.md).

const DATE_TIME = { type: String, format: 'date-time' } as const;
const NULLABLE_TEXT = { type: String, nullable: true } as const;

/** A line of a new transfer (ADR-0172). */
export class TransferLineInputDto {
  /** La variante que se traslada, en cualquier estado; una vez por traslado. */
  @IsUUID()
  variantId: string;

  /** De 1 a 100,000 unidades disponibles en el origen. @example 2 */
  @IsInt()
  @Min(1)
  @Max(MAX_STOCK_QUANTITY)
  quantity: number;
}

/** Request of `POST /v1/admin/inventory/transfers` (ADR-0172). */
export class CreateTransferDto {
  @ApiPropertyOptional({
    enum: TRANSFER_KINDS,
    default: 'TRANSFER',
    description:
      '`TRANSFER`, un traslado definitivo, o `LOAN`, un préstamo para mostrar, con `returnBy` (T-164).',
  })
  @IsOptional()
  @IsIn(TRANSFER_KINDS)
  kind?: TransferKind;

  /** El almacén de donde salen las unidades, en cualquier estado. */
  @IsUUID()
  fromWarehouseId: string;

  /** El almacén al que llegan: activo y distinto del origen. */
  @IsUUID()
  toWarehouseId: string;

  @ApiProperty({
    enum: REQUESTED_TRANSFER_REASONS,
    description:
      'En un traslado, `SALE` para venderlo en el destino, `RESTOCK` para surtirlo u `OTHER` con `note` obligatoria; en un préstamo, `SHOW`.',
  })
  @IsIn(REQUESTED_TRANSFER_REASONS)
  reason: TransferReason;

  /** Hasta 500 caracteres; obligatoria con `OTHER`. */
  @ApiPropertyOptional({
    ...NULLABLE_TEXT,
    example: 'Para enseñarlo a un cliente',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_NOTE_LENGTH)
  note?: string | null;

  @ApiProperty({
    type: () => [TransferLineInputDto],
    description: `De 1 a ${MAX_TRANSFER_LINES} líneas, cada variante una vez.`,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_TRANSFER_LINES)
  @ValidateNested({ each: true })
  @Type(() => TransferLineInputDto)
  lines: TransferLineInputDto[];

  @ApiPropertyOptional({
    ...DATE_TIME,
    example: '2026-11-08T19:00:00.000Z',
    description:
      'Solo en un préstamo, y obligatoria: cuándo debe regresar, de 5 minutos a 24 horas después de registrarlo.',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  returnBy?: string;
}

/** Request of `POST …/transfers/{transferId}/cancel` (ADR-0172). */
export class CancelTransferDto {
  /** Versión leída del traslado (bloqueo optimista). */
  @IsInt()
  @Min(1)
  version: number;
}

/** What came back of a loan line. */
export class ReturnedLineInputDto {
  /** Una línea del préstamo, una vez. */
  @IsUUID()
  variantId: string;

  /** Unidades que regresaron, de 0 a las prestadas. @example 1 */
  @IsInt()
  @Min(0)
  @Max(MAX_STOCK_QUANTITY)
  returned: number;
}

/** Request of `POST …/transfers/{transferId}/close` (T-164, ADR-0172). */
export class CloseLoanDto {
  /** Versión leída del préstamo (bloqueo optimista). */
  @IsInt()
  @Min(1)
  version: number;

  @ApiProperty({
    type: () => [ReturnedLineInputDto],
    description: 'Cada línea del préstamo, una vez, con lo que regresó.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_TRANSFER_LINES)
  @ValidateNested({ each: true })
  @Type(() => ReturnedLineInputDto)
  lines: ReturnedLineInputDto[];
}

/** A line of a transfer as the API answers it. */
export class TransferLineDto {
  @ApiProperty({ format: 'uuid' })
  variantId: string;

  /** @example 'JUE-ZELDA-SW' */
  sku: string;

  /** @example 'The Legend of Zelda' */
  productTitle: string;

  /** Unidades trasladadas. @example 2 */
  quantity: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'En un préstamo cerrado, las unidades que regresaron; `null` mientras está abierto, y siempre en un traslado.',
  })
  returned: number | null;
}

/** `StockTransfer` of API_SPEC.md §13 (ADR-0172). */
export class TransferDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  /** El folio, consecutivo: `T-` en un traslado y `P-` en un préstamo. @example 'T-000123' */
  folio: string;

  @ApiProperty({ enum: TRANSFER_KINDS })
  kind: string;

  @ApiProperty({ format: 'uuid' })
  fromWarehouseId: string;

  @ApiProperty({ format: 'uuid' })
  toWarehouseId: string;

  @ApiProperty({ enum: TRANSFER_REASONS })
  reason: string;

  /** Nota del staff; `null` sin ella. */
  @ApiProperty(NULLABLE_TEXT)
  note: string | null;

  @ApiProperty({
    enum: TRANSFER_STATUSES,
    description:
      'Un traslado está `COMPLETED` al registrarse; un préstamo, `OPEN` hasta que se cierra (`CLOSED`). `CANCELLED` si se canceló en sus primeros 10 minutos.',
  })
  status: string;

  @ApiProperty({
    type: () => [TransferLineDto],
    description: 'Por variante.',
  })
  lines: TransferLineDto[];

  @ApiProperty({
    format: 'uuid',
    description: 'La cuenta de staff que lo registró.',
  })
  createdBy: string;

  @ApiProperty(DATE_TIME)
  createdAt: Date;

  @ApiProperty({
    ...DATE_TIME,
    nullable: true,
    description:
      'Hasta cuándo se puede cancelar: 10 minutos después de registrarse; `null` si ya no se puede por su estado (cancelado, préstamo cerrado o regreso de un préstamo).',
  })
  cancellableUntil: Date | null;

  @ApiProperty({
    ...NULLABLE_TEXT,
    format: 'uuid',
    description: 'La cuenta de staff que lo canceló; `null` si no se canceló.',
  })
  cancelledBy: string | null;

  @ApiProperty({ ...DATE_TIME, nullable: true })
  cancelledAt: Date | null;

  @ApiProperty({
    ...DATE_TIME,
    nullable: true,
    description: 'En un préstamo, cuándo debe regresar; `null` en un traslado.',
  })
  returnBy: Date | null;

  /** Un préstamo abierto cuya hora de regreso ya pasó. */
  overdue: boolean;

  @ApiProperty({
    ...NULLABLE_TEXT,
    format: 'uuid',
    description:
      'La cuenta de staff que cerró el préstamo; `null` si no se ha cerrado.',
  })
  closedBy: string | null;

  @ApiProperty({ ...DATE_TIME, nullable: true })
  closedAt: Date | null;

  @ApiProperty({
    ...NULLABLE_TEXT,
    format: 'uuid',
    description: 'En el regreso de un préstamo (`LOAN_RETURN`), el préstamo.',
  })
  loanId: string | null;

  @ApiProperty({
    ...NULLABLE_TEXT,
    format: 'uuid',
    description:
      'En un préstamo cerrado, el traslado que regresó sus unidades; `null` si no regresó ninguna o no se ha cerrado.',
  })
  returnTransferId: string | null;

  /** Versión para cancelarlo o cerrarlo (bloqueo optimista). @example 1 */
  version: number;
}

export class TransferListDto {
  @ApiProperty({
    type: () => [TransferDto],
    description: 'Del más reciente al más antiguo.',
  })
  data: TransferDto[];

  @ApiProperty({ type: () => PageMetaDto })
  meta: PageMetaDto;
}

/** Query of `GET /v1/admin/inventory/transfers` (ADR-0172). */
export class TransferListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    enum: TRANSFER_KINDS,
    description: 'Solo los traslados o solo los préstamos.',
  })
  @IsOptional()
  @IsIn(TRANSFER_KINDS)
  kind?: TransferKind;

  /** `true`, solo los préstamos abiertos cuya hora de regreso ya pasó; `false`, todos los demás. */
  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  overdue?: boolean;

  /** Los que salen de este almacén o llegan a él. */
  @IsOptional()
  @IsUUID('all')
  warehouseId?: string;

  /** Los que tienen una línea de esta variante. */
  @IsOptional()
  @IsUUID('all')
  variantId?: string;

  @ApiPropertyOptional({
    enum: TRANSFER_REASONS,
    description: 'Los traslados con este motivo.',
  })
  @IsOptional()
  @IsIn(TRANSFER_REASONS)
  reason?: TransferReason;

  @ApiPropertyOptional({
    enum: TRANSFER_STATUSES,
    description: 'Los traslados en este estado.',
  })
  @IsOptional()
  @IsIn(TRANSFER_STATUSES)
  status?: TransferStatus;

  /** Fecha o fecha y hora ISO 8601; incluida. @example '2026-11-01' */
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  /** Fecha o fecha y hora ISO 8601; incluida (una fecha sola incluye todo el día). @example '2026-11-30' */
  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}
