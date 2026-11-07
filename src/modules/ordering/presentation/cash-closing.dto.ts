import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MoneyDto } from '../../../platform/http/money.dto.js';
import {
  PageMetaDto,
  PageQueryDto,
} from '../../../platform/http/pagination/page-query.dto.js';
import { MAX_MONEY_AMOUNT } from '../../../shared-kernel/index.js';
import {
  COLLECTION_METHODS,
  type CollectionMethod,
  MAX_CASH_CLOSING_NOTE_LENGTH,
} from '../application/cash-closings.use-case.js';

// Plain string, number and boolean fields are documented by the Swagger plugin from their types and comments;
// money, nested objects, nullable fields and enums say it with @ApiProperty (ADR-0096).

const NOT_BLANK = { context: { message: 'No puede estar vacío.' } };

/** A day of the calendar, `YYYY-MM-DD`; the use case checks that it exists. */
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const IS_DATE = { context: { message: 'Debe ser una fecha AAAA-MM-DD.' } };

/** What was collected with one method in the day (ADR-0171). */
export class MethodTotalDto {
  @ApiProperty({
    enum: COLLECTION_METHODS,
    nullable: true,
    description:
      'Efectivo, terminal o transferencia; `null` para los cobros sin método: de un proveedor, o sin que el staff lo dijera.',
  })
  method: CollectionMethod | null;

  /** Cobros. @example 12 */
  count: number;

  @ApiProperty({ type: () => MoneyDto })
  amount: MoneyDto;
}

/** What a staff member registered in the day (ADR-0171). */
export class StaffTotalDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'La cuenta de staff que registró los cobros y reembolsos; `null` para los que no registró nadie, como los de un proveedor.',
  })
  staffId: string | null;

  /** Cobros que registró. @example 7 */
  paymentCount: number;

  @ApiProperty({ type: () => MoneyDto, description: 'Lo que cobró.' })
  paymentAmount: MoneyDto;

  @ApiProperty({
    type: () => MoneyDto,
    description: 'Lo que cobró en efectivo.',
  })
  cashAmount: MoneyDto;

  @ApiProperty({
    type: () => MoneyDto,
    description: 'Lo que reembolsó.',
  })
  refundAmount: MoneyDto;
}

/** The figures of the cash of a store in a day (ADR-0171). */
export class CashDayDto {
  /** Órdenes de la tienda física colocadas ese día en el almacén. @example 18 */
  placedCount: number;

  @ApiProperty({
    type: () => MoneyDto,
    description: 'El total de esas órdenes.',
  })
  placedAmount: MoneyDto;

  /** De esas, las que siguen esperando su pago: vendidas sin cobrar. @example 1 */
  pendingPaymentCount: number;

  /** Órdenes de la tienda física canceladas ese día, cuando sea que se colocaron. @example 0 */
  cancelledCount: number;

  @ApiProperty({
    type: () => [MethodTotalDto],
    description:
      'Lo cobrado ese día por método: `CASH`, `CARD_TERMINAL`, `TRANSFER` y sin método, siempre los cuatro y en ese orden.',
  })
  payments: MethodTotalDto[];

  @ApiProperty({
    type: () => MoneyDto,
    description: 'Todo lo cobrado ese día.',
  })
  paymentAmount: MoneyDto;

  /** Reembolsos completados ese día. @example 0 */
  refundCount: number;

  @ApiProperty({ type: () => MoneyDto, description: 'Lo reembolsado ese día.' })
  refundAmount: MoneyDto;

  @ApiProperty({
    type: () => MoneyDto,
    description: 'Lo reembolsado de pagos cobrados en efectivo.',
  })
  cashRefundAmount: MoneyDto;

  @ApiProperty({
    type: () => MoneyDto,
    description:
      'El efectivo esperado en la caja: lo cobrado en efectivo menos lo reembolsado de pagos en efectivo. Puede ser negativo.',
  })
  expectedCash: MoneyDto;

  @ApiProperty({
    type: () => [StaffTotalDto],
    description:
      'Por quien registró cada cobro o reembolso; los que no registró nadie, al final.',
  })
  byStaff: StaffTotalDto[];

  /** Líneas de precio libre de las órdenes colocadas ese día, sin las canceladas, reembolsadas o vencidas (ADR-0171). @example 3 */
  openPriceLineCount: number;

  @ApiProperty({
    type: () => MoneyDto,
    description: 'El total de esas líneas.',
  })
  openPriceAmount: MoneyDto;
}

/** A closing of the cash (ADR-0171). */
export class CashClosingDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  warehouseId: string;

  /** El día de la Ciudad de México que cierra. @example '2026-11-07' */
  date: string;

  @ApiProperty({
    type: () => MoneyDto,
    description: 'El efectivo esperado al cerrar. Puede ser negativo.',
  })
  expectedCash: MoneyDto;

  @ApiProperty({
    type: () => MoneyDto,
    description: 'El efectivo que contó el staff.',
  })
  countedCash: MoneyDto;

  @ApiProperty({
    type: () => MoneyDto,
    description: 'Contado menos esperado: negativo si falta efectivo.',
  })
  difference: MoneyDto;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Por qué hay diferencia; siempre la hay si `difference` no es 0.',
  })
  note: string | null;

  @ApiProperty({
    type: () => CashDayDto,
    description: 'El resumen del día al cerrar.',
  })
  summary: CashDayDto;

  @ApiProperty({ format: 'uuid', description: 'La cuenta de staff que cerró.' })
  closedBy: string;

  @ApiProperty({ type: String, format: 'date-time' })
  closedAt: Date;
}

/** What came after the closing of the day (ADR-0171). */
export class AfterClosingDto {
  /** Cobros posteriores al cierre. @example 1 */
  paymentCount: number;

  @ApiProperty({ type: () => MoneyDto })
  paymentAmount: MoneyDto;

  @ApiProperty({ type: () => MoneyDto, description: 'De ellos, en efectivo.' })
  cashAmount: MoneyDto;

  /** Reembolsos posteriores al cierre. @example 0 */
  refundCount: number;

  @ApiProperty({ type: () => MoneyDto })
  refundAmount: MoneyDto;

  @ApiProperty({
    type: () => MoneyDto,
    description: 'De ellos, de pagos en efectivo.',
  })
  cashRefundAmount: MoneyDto;
}

/** Response of `GET /v1/admin/cash-closings/summary` (ADR-0171). */
export class CashSummaryDto extends CashDayDto {
  @ApiProperty({ format: 'uuid' })
  warehouseId: string;

  /** @example '2026-11-07' */
  date: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Cuándo empieza el día en la Ciudad de México.',
  })
  from: Date;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Cuándo termina, sin incluirlo.',
  })
  to: Date;

  @ApiProperty({
    type: () => CashClosingDto,
    nullable: true,
    description: 'El cierre del día; `null` mientras no lo tenga.',
  })
  closing: CashClosingDto | null;

  @ApiProperty({
    type: () => AfterClosingDto,
    nullable: true,
    description:
      'Lo que llegó después del cierre, que ya va en los totales del día; `null` sin cierre.',
  })
  afterClosing: AfterClosingDto | null;
}

/** Query of `GET /v1/admin/cash-closings/summary` (ADR-0171). */
export class CashSummaryQueryDto {
  /** El almacén del local. */
  @IsUUID('all')
  warehouseId: string;

  /** El día de la Ciudad de México, `AAAA-MM-DD`. @example '2026-11-07' */
  @Matches(DATE, IS_DATE)
  date: string;
}

/** Request of `POST /v1/admin/cash-closings` (ADR-0171). */
export class CloseCashDto extends CashSummaryQueryDto {
  /** El efectivo contado en la caja, en centavos. @example 352500 */
  @IsInt()
  @Min(0)
  @Max(MAX_MONEY_AMOUNT)
  countedCash: number;

  /** Hasta 500 caracteres; obligatoria si el contado no es el esperado. @example 'Faltan $20 de un cambio mal dado.' */
  @IsOptional()
  @IsString()
  @Matches(/\S/, NOT_BLANK)
  @MaxLength(MAX_CASH_CLOSING_NOTE_LENGTH)
  note?: string;
}

export class CashClosingListDto {
  @ApiProperty({ type: () => [CashClosingDto] })
  data: CashClosingDto[];

  @ApiProperty({ type: () => PageMetaDto })
  meta: PageMetaDto;
}

/** Query of `GET /v1/admin/cash-closings` (ADR-0171). */
export class CashClosingListQueryDto extends PageQueryDto {
  /** Solo los cierres de este almacén. */
  @IsOptional()
  @IsUUID('all')
  warehouseId?: string;

  /** Desde este día, incluido. @example '2026-11-01' */
  @ApiPropertyOptional({ example: '2026-11-01' })
  @IsOptional()
  @Matches(DATE, IS_DATE)
  dateFrom?: string;

  /** Hasta este día, incluido. @example '2026-11-30' */
  @ApiPropertyOptional({ example: '2026-11-30' })
  @IsOptional()
  @Matches(DATE, IS_DATE)
  dateTo?: string;
}
