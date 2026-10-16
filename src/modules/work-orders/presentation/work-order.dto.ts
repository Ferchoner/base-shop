import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
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
} from 'class-validator';
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
  WORK_ORDER_STATUSES,
  WORK_ORDER_TEXT_LIMITS as LIMITS,
  type WorkOrderStatus,
} from '../application/work-order-values.js';

// Plain string, number and boolean fields are documented by the Swagger plugin from their types and comments;
// fields holding other DTOs, lists, dates, enums, objects or null declare their type with @ApiProperty
// (DEVELOPMENT_GUIDE.md).

const NOT_BLANK = { context: { message: 'No puede estar vacío.' } };
const PHONE = { context: { message: 'Debe tener exactamente 10 dígitos.' } };

const toNormalizedEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/** Equipment received in the physical store (UC-WRK-01, API_SPEC.md §25.2). */
export class ReceiveWorkOrderDto {
  /** El almacén activo de la tienda que recibe el equipo, como en la venta de mostrador (ADR-0161). */
  @IsUUID('all')
  warehouseId: string;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description:
      'Un cliente registrado y activo, para ligarle la orden; el nombre y el teléfono se piden igual, porque la cuenta no guarda teléfono (ADR-0166).',
  })
  @IsOptional()
  @IsUUID('all')
  customerId?: string | null;

  /** Nombre del cliente, de 1 a 120 caracteres. @example 'María López Hernández' */
  @IsString()
  @Length(1, LIMITS.customerName)
  @Matches(/\S/, NOT_BLANK)
  customerName: string;

  /** Teléfono del cliente: exactamente 10 dígitos. @example '4431234567' */
  @Matches(/^[0-9]{10}$/, PHONE)
  customerPhone: string;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: LIMITS.customerEmail,
    description: 'Email del cliente; se guarda sin espacios y en minúsculas.',
  })
  @IsOptional()
  @Transform(toNormalizedEmail)
  @IsEmail()
  @MaxLength(LIMITS.customerEmail)
  customerEmail?: string | null;

  /** Tipo de equipo, de 1 a 60 caracteres. @example 'Laptop' */
  @IsString()
  @Length(1, LIMITS.equipmentType)
  @Matches(/\S/, NOT_BLANK)
  equipmentType: string;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: LIMITS.equipmentBrand,
    description: 'Marca del equipo.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(LIMITS.equipmentBrand)
  equipmentBrand?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: LIMITS.equipmentModel,
    description: 'Modelo del equipo.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(LIMITS.equipmentModel)
  equipmentModel?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: LIMITS.serialNumber,
    description: 'Número de serie.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(LIMITS.serialNumber)
  serialNumber?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: LIMITS.accessories,
    description: 'Accesorios que se reciben con el equipo, como el cargador.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(LIMITS.accessories)
  accessories?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: LIMITS.equipmentCondition,
    description: 'Cómo se recibe el equipo, como golpes o rayones.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(LIMITS.equipmentCondition)
  equipmentCondition?: string | null;

  /** La falla que reporta el cliente, de 1 a 2,000 caracteres. @example 'No enciende' */
  @IsString()
  @Length(1, LIMITS.reportedFault)
  @Matches(/\S/, NOT_BLANK)
  reportedFault: string;

  @ApiPropertyOptional({
    nullable: true,
    minimum: 0,
    maximum: MAX_MONEY_AMOUNT,
    description:
      'Costo estimado en centavos, informativo: la orden de trabajo no cobra; se cobra con ventas de mostrador (ADR-0165).',
    example: 35_000,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_MONEY_AMOUNT)
  estimatedCost?: number | null;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'El técnico asignado: una cuenta de staff activa.',
  })
  @IsOptional()
  @IsUUID('all')
  technicianId?: string | null;
}

/**
 * Changes to a work order (UC-WRK-03): only the fields sent change. Required fields cannot be `null`; the optional
 * ones are cleared with `null`.
 */
export class UpdateWorkOrderDto {
  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description:
      'Un cliente registrado y activo; `null` desliga la orden de la cuenta.',
  })
  @IsOptional()
  @IsUUID('all')
  customerId?: string | null;

  /** De 1 a 120 caracteres. */
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @Length(1, LIMITS.customerName)
  @Matches(/\S/, NOT_BLANK)
  customerName?: string;

  /** Exactamente 10 dígitos. */
  @ValidateIf((_, value) => value !== undefined)
  @Matches(/^[0-9]{10}$/, PHONE)
  customerPhone?: string;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: LIMITS.customerEmail,
    description: '`null` lo quita.',
  })
  @IsOptional()
  @Transform(toNormalizedEmail)
  @IsEmail()
  @MaxLength(LIMITS.customerEmail)
  customerEmail?: string | null;

  /** De 1 a 60 caracteres. */
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @Length(1, LIMITS.equipmentType)
  @Matches(/\S/, NOT_BLANK)
  equipmentType?: string;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: LIMITS.equipmentBrand,
    description: '`null` la quita.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(LIMITS.equipmentBrand)
  equipmentBrand?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: LIMITS.equipmentModel,
    description: '`null` lo quita.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(LIMITS.equipmentModel)
  equipmentModel?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: LIMITS.serialNumber,
    description: '`null` lo quita.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(LIMITS.serialNumber)
  serialNumber?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: LIMITS.accessories,
    description: '`null` los quita.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(LIMITS.accessories)
  accessories?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: LIMITS.equipmentCondition,
    description: '`null` lo quita.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(LIMITS.equipmentCondition)
  equipmentCondition?: string | null;

  /** De 1 a 2,000 caracteres. */
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @Length(1, LIMITS.reportedFault)
  @Matches(/\S/, NOT_BLANK)
  reportedFault?: string;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: LIMITS.diagnosis,
    description: 'El diagnóstico del técnico; `null` lo quita.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(LIMITS.diagnosis)
  diagnosis?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: LIMITS.workPerformed,
    description: 'El trabajo realizado; `null` lo quita.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(LIMITS.workPerformed)
  workPerformed?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    minimum: 0,
    maximum: MAX_MONEY_AMOUNT,
    description: 'Costo estimado en centavos, informativo; `null` lo quita.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_MONEY_AMOUNT)
  estimatedCost?: number | null;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description:
      'Un técnico nuevo debe ser una cuenta de staff activa; `null` lo quita.',
  })
  @IsOptional()
  @IsUUID('all')
  technicianId?: string | null;

  /** Versión leída (bloqueo optimista). */
  @IsInt()
  @Min(1)
  version: number;
}

/** A status change (UC-WRK-04, API_SPEC.md §25.6). */
export class ChangeWorkOrderStatusDto {
  @ApiProperty({
    enum: WORK_ORDER_STATUSES,
    description:
      'Uno adelante del actual, aunque salte pasos: `RECEIVED` → `DIAGNOSED` → `IN_REPAIR` → `READY` → `DELIVERED`; o `CANCELLED` antes de `DELIVERED` (ADR-0166).',
  })
  @IsIn(WORK_ORDER_STATUSES)
  status: WorkOrderStatus;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: LIMITS.note,
    description:
      'Nota del cambio, de 1 a 500 caracteres; obligatoria para `CANCELLED`. Queda en el historial y en la auditoría: no escribas datos personales.',
  })
  @ValidateIf(
    (body: { status?: unknown }, value) =>
      body.status === 'CANCELLED' || (value !== undefined && value !== null),
  )
  @IsString()
  @Length(1, LIMITS.note)
  @Matches(/\S/, NOT_BLANK)
  note?: string | null;

  /** Versión leída (bloqueo optimista). */
  @IsInt()
  @Min(1)
  version: number;
}

/** Query of `GET /v1/admin/work-orders` (UC-WRK-02, API_SPEC.md §25.3). */
export class WorkOrderListQueryDto extends PageQueryDto {
  /**
   * El folio exacto (`OT-000123`, `ot-123` o `123`), o parte del nombre o del teléfono del cliente, o del número de
   * serie, sin distinguir mayúsculas.
   */
  @IsOptional()
  @IsString()
  @MaxLength(254)
  q?: string;

  @ApiPropertyOptional({
    type: String,
    description: `Uno o más estados separados por comas: ${WORK_ORDER_STATUSES.map((status) => `\`${status}\``).join(', ')}.`,
    example: 'RECEIVED,DIAGNOSED',
  })
  @IsOptional()
  @CommaSeparated()
  @IsIn(WORK_ORDER_STATUSES, { each: true })
  status?: WorkOrderStatus[];

  /** Las que recibió la tienda de este almacén. */
  @IsOptional()
  @IsUUID('all')
  warehouseId?: string;

  /** Las asignadas a este técnico. */
  @IsOptional()
  @IsUUID('all')
  technicianId?: string;

  /** Las ligadas a este cliente registrado. */
  @IsOptional()
  @IsUUID('all')
  customerId?: string;

  /** Fecha o fecha y hora ISO 8601; incluida. @example '2026-10-01' */
  @IsOptional()
  @IsISO8601({ strict: true })
  receivedFrom?: string;

  /** Fecha o fecha y hora ISO 8601; incluida (una fecha sola incluye todo el día). @example '2026-10-31' */
  @IsOptional()
  @IsISO8601({ strict: true })
  receivedTo?: string;

  /** `receivedAt` o `folio`, con `-` para orden descendente; por defecto `-receivedAt`. */
  @IsOptional()
  @IsSortOf(['receivedAt', 'folio'])
  sort?: string;
}

/** An entry of `statusHistory`. */
export class WorkOrderStatusEntryDto {
  @ApiProperty({
    enum: WORK_ORDER_STATUSES,
    nullable: true,
    description: '`null` al recibir el equipo.',
  })
  fromStatus: WorkOrderStatus | null;

  /** El estado al que pasó. */
  @ApiProperty({ enum: WORK_ORDER_STATUSES })
  toStatus: WorkOrderStatus;

  /** La cuenta de staff que hizo el cambio. */
  @ApiProperty({ type: String, format: 'uuid' })
  actorId: string;

  /** La nota del cambio; `null` sin ella. */
  @ApiProperty({ nullable: true })
  note: string | null;

  /** Cuándo ocurrió. */
  @ApiProperty({ type: String, format: 'date-time' })
  occurredAt: Date;
}

/** Shared fields of a work order in a list and alone. */
export class WorkOrderSummaryDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id: string;

  /** Folio consecutivo (ADR-0166). @example 'OT-000123' */
  folio: string;

  @ApiProperty({ enum: WORK_ORDER_STATUSES })
  status: WorkOrderStatus;

  customerName: string;

  /** 10 dígitos. */
  customerPhone: string;

  equipmentType: string;

  @ApiProperty({ nullable: true })
  equipmentBrand: string | null;

  @ApiProperty({ nullable: true })
  equipmentModel: string | null;

  @ApiProperty({ nullable: true })
  serialNumber: string | null;

  /** El almacén de la tienda que recibió el equipo. */
  @ApiProperty({ type: String, format: 'uuid' })
  warehouseId: string;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description: 'El técnico asignado.',
  })
  technicianId: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  receivedAt: Date;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Cuándo se entregó o se canceló.',
  })
  closedAt: Date | null;
}

/** `WorkOrder` (API_SPEC.md §25.1). */
export class WorkOrderDto extends WorkOrderSummaryDto {
  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description: 'El cliente registrado ligado.',
  })
  customerId: string | null;

  @ApiProperty({ nullable: true })
  customerEmail: string | null;

  @ApiProperty({ nullable: true })
  accessories: string | null;

  @ApiProperty({ nullable: true })
  equipmentCondition: string | null;

  reportedFault: string;

  @ApiProperty({ nullable: true })
  diagnosis: string | null;

  @ApiProperty({ nullable: true })
  workPerformed: string | null;

  @ApiProperty({
    type: () => MoneyDto,
    nullable: true,
    description: 'Informativo; la orden de trabajo no cobra (ADR-0165).',
  })
  estimatedCost: MoneyDto | null;

  /** La cuenta de staff que recibió el equipo. */
  @ApiProperty({ type: String, format: 'uuid' })
  receivedBy: string;

  /** Para el bloqueo optimista. */
  version: number;

  @ApiProperty({
    type: () => [WorkOrderStatusEntryDto],
    description: 'Del más antiguo al más reciente.',
  })
  statusHistory: WorkOrderStatusEntryDto[];
}

export class WorkOrderListDto {
  @ApiProperty({ type: () => [WorkOrderSummaryDto] })
  data: WorkOrderSummaryDto[];

  @ApiProperty({ type: () => PageMetaDto })
  meta: PageMetaDto;
}
