import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

// Plain string, number and boolean fields are documented by the Swagger plugin from their types and comments.
// Fields holding other DTOs, dates or null declare their type with @ApiProperty (DEVELOPMENT_GUIDE.md).

/** Query of `POST /v1/admin/inventory/receipt-imports` (UC-INV-12). */
export class ReceiptImportQueryDto {
  /** Valida el archivo y responde el resumen sin guardar nada. */
  @ApiPropertyOptional({ type: Boolean, default: false })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  dryRun?: boolean;
}

/** What a bulk import of receipts did, or would do with `dryRun` (API_SPEC.md §13, ADR-0164). */
export class ReceiptImportSummaryDto {
  /** Filas del archivo, sin el encabezado: una entrada de mercancía cada una. */
  rows: number;

  /** Unidades recibidas, la suma de las cantidades. */
  units: number;

  /** `true` si solo se validó el archivo, sin guardar entradas. */
  dryRun: boolean;
}
