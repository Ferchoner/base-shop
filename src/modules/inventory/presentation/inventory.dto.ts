import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
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
  NotEquals,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  AddressInputDto,
  PostalAddressDto,
} from '../../../platform/http/address.dto.js';
import {
  CursorMetaDto,
  CursorQueryDto,
} from '../../../platform/http/pagination/cursor.js';
import {
  PageMetaDto,
  PageQueryDto,
} from '../../../platform/http/pagination/page-query.dto.js';
import {
  CommaSeparated,
  IsSortOf,
} from '../../../platform/http/pagination/pagination.js';
import {
  ADJUSTMENT_REASONS,
  type AdjustmentReason,
  MAX_NOTE_LENGTH,
  MAX_STOCK_QUANTITY,
  MAX_WAREHOUSE_NAME_LENGTH,
  STOCK_MOVEMENT_REASONS,
  STOCK_MOVEMENT_TYPES,
  type StockMovementType,
} from '../application/inventory-limits.js';

// Plain string, number and boolean fields are documented by the Swagger plugin from their types and comments.
// Fields holding other DTOs, dates or null declare their type with @ApiProperty (DEVELOPMENT_GUIDE.md).

const DATE_TIME = { type: String, format: 'date-time' } as const;
const NULLABLE_TEXT = { type: String, nullable: true } as const;
const NOT_BLANK = { context: { message: 'No puede estar vacío.' } };

/** `Warehouse` of API_SPEC.md §13. */
export class WarehouseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  /** @example 'PRINCIPAL' */
  code: string;

  /** @example 'Almacén principal' */
  name: string;

  /** `null` mientras no se capture. */
  @ApiProperty({ type: () => PostalAddressDto, nullable: true })
  address: PostalAddressDto | null;

  /** `ACTIVE` o `INACTIVE`; en el MVP, el único almacén está activo (ADR-0081). */
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'] })
  status: string;

  @ApiProperty(DATE_TIME)
  createdAt: Date;

  @ApiProperty(DATE_TIME)
  updatedAt: Date;
}

export class WarehouseListDto {
  @ApiProperty({ type: () => [WarehouseDto] })
  data: WarehouseDto[];
}

/** `PATCH …/warehouses/{warehouseId}` (UC-INV-01): only the fields sent change. */
export class UpdateWarehouseDto {
  /** De 1 a 100 caracteres. @example 'Almacén Morelia' */
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @Length(1, MAX_WAREHOUSE_NAME_LENGTH)
  @Matches(/\S/, NOT_BLANK)
  name?: string;

  @ApiPropertyOptional({
    type: () => AddressInputDto,
    nullable: true,
    description: 'Formato `AddressInput` (ADR-0057); `null` la quita.',
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AddressInputDto)
  address?: AddressInputDto | null;
}

/** `StockItem` of API_SPEC.md §13. */
export class StockItemDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  variantId: string;

  /** @example 'CAM-LINO-M' */
  sku: string;

  /** @example 'Camisa de lino' */
  productTitle: string;

  @ApiProperty({ format: 'uuid' })
  warehouseId: string;

  /**
   * Unidades físicas en el almacén.
   * @example 25
   */
  onHand: number;

  /**
   * Unidades apartadas por órdenes que esperan su pago.
   * @example 3
   */
  reserved: number;

  /** `onHand − reserved`. @example 22 */
  available: number;

  @ApiProperty(DATE_TIME)
  updatedAt: Date;
}

export class StockItemListDto {
  @ApiProperty({ type: () => [StockItemDto] })
  data: StockItemDto[];

  @ApiProperty({ type: () => PageMetaDto })
  meta: PageMetaDto;
}

/** Query of `GET …/stock-items` (UC-INV-04). */
export class StockItemQueryDto extends PageQueryDto {
  /** Solo las existencias de esta variante. */
  @IsOptional()
  @IsUUID()
  variantId?: string;

  /** SKU exacto, sin distinguir mayúsculas; un SKU tiene a lo sumo 64 caracteres. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sku?: string;

  /** Solo las existencias de este almacén. */
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  /** Parte del SKU o del título del producto, sin distinguir mayúsculas; hasta 100 caracteres. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  /** A lo sumo esta cantidad disponible, para detectar existencias bajas. @example 5 */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  // The largest integer of PostgreSQL: a larger one is a validation error and not a 500 (T-310).
  @Max(2_147_483_647)
  availableMax?: number;

  /** `sku`, `available` o `updatedAt`, con `-` para orden descendente; por defecto `sku`. */
  @IsOptional()
  @IsSortOf(['sku', 'available', 'updatedAt'])
  sort?: string;
}

/** `StockMovement` of API_SPEC.md §13. */
export class StockMovementDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  /** `RECEIPT`, `ADJUSTMENT`, `SALE` o `RESTOCK`. */
  @ApiProperty({ enum: STOCK_MOVEMENT_TYPES })
  type: string;

  /** Con signo. @example -2 */
  quantity: number;

  /**
   * Unidades físicas después del movimiento.
   * @example 23
   */
  onHandAfter: number;

  /** El motivo de un ajuste; `null` en los demás movimientos. */
  @ApiProperty({ enum: STOCK_MOVEMENT_REASONS, nullable: true })
  reasonCode: string | null;

  /** Nota del staff; `null` sin ella. */
  @ApiProperty(NULLABLE_TEXT)
  note: string | null;

  /** La orden de una venta o un reintegro; `null` en los demás. */
  @ApiProperty({ ...NULLABLE_TEXT, format: 'uuid' })
  orderId: string | null;

  /** La línea de la orden de una venta o un reintegro; `null` en los demás. */
  @ApiProperty({ ...NULLABLE_TEXT, format: 'uuid' })
  orderLineId: string | null;

  @ApiProperty({
    ...NULLABLE_TEXT,
    format: 'uuid',
    description: 'Staff que lo registró; `null` si fue el sistema.',
  })
  actorId: string | null;

  @ApiProperty(DATE_TIME)
  createdAt: Date;
}

export class StockMovementListDto {
  @ApiProperty({
    type: () => [StockMovementDto],
    description: 'Del más reciente al más antiguo.',
  })
  data: StockMovementDto[];

  @ApiProperty({ type: () => CursorMetaDto })
  meta: CursorMetaDto;
}

/** Query of `GET …/stock-items/{stockItemId}/movements` (UC-INV-04). */
export class StockMovementQueryDto extends CursorQueryDto {
  @ApiPropertyOptional({
    type: String,
    description:
      'Uno o más tipos separados por comas: `RECEIPT`, `ADJUSTMENT`, `SALE`, `RESTOCK`.',
    example: 'RECEIPT,ADJUSTMENT',
  })
  @IsOptional()
  @CommaSeparated()
  @IsIn(STOCK_MOVEMENT_TYPES, { each: true })
  type?: StockMovementType[];

  /** Fecha o fecha y hora ISO 8601; incluida. @example '2026-10-01' */
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  /** Fecha o fecha y hora ISO 8601; incluida (una fecha sola incluye todo el día). @example '2026-10-31' */
  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}

/** `POST …/receipts` (UC-INV-02). */
export class ReceiptDto {
  /** La variante que entra, en cualquier estado. */
  @IsUUID()
  variantId: string;

  /** Debe ser el almacén activo. */
  @IsUUID()
  warehouseId: string;

  /** De 1 a 100,000. @example 25 */
  @IsInt()
  @Min(1)
  @Max(MAX_STOCK_QUANTITY)
  quantity: number;

  /** Nota opcional, como el número de remisión. */
  @ApiPropertyOptional({ ...NULLABLE_TEXT, example: 'Remisión 1234' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_NOTE_LENGTH)
  note?: string | null;
}

/** `POST …/adjustments` (UC-INV-03, ADR-0069). */
export class AdjustmentDto {
  /** La variante que se ajusta, en cualquier estado. */
  @IsUUID()
  variantId: string;

  /** Debe ser el almacén activo. */
  @IsUUID()
  warehouseId: string;

  /** Con signo, de −100,000 a 100,000 y distinta de 0. @example -2 */
  @IsInt()
  @NotEquals(0, { context: { message: 'No puede ser 0.' } })
  @Min(-MAX_STOCK_QUANTITY)
  @Max(MAX_STOCK_QUANTITY)
  quantity: number;

  @ApiProperty({
    enum: ADJUSTMENT_REASONS,
    description:
      '`DAMAGED`, `LOSS_OR_THEFT` e `INTERNAL_USE` solo con cantidad negativa; `OTHER` exige `note`.',
  })
  @IsIn(ADJUSTMENT_REASONS)
  reasonCode: AdjustmentReason;

  /** Nota del ajuste; obligatoria con el motivo `OTHER`. */
  @ApiPropertyOptional({ ...NULLABLE_TEXT, example: 'Caja mojada' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_NOTE_LENGTH)
  note?: string | null;
}

/** A receipt or adjustment: the stock after it and its movement. */
export class StockEntryDto {
  @ApiProperty({ type: () => StockItemDto })
  stockItem: StockItemDto;

  @ApiProperty({ type: () => StockMovementDto })
  movement: StockMovementDto;
}
