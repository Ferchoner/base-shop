import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

// Plain string, number and boolean fields are documented by the Swagger plugin from their types and comments.
// Fields holding other DTOs, dates or null declare their type with @ApiProperty (DEVELOPMENT_GUIDE.md).

/** Query of `POST /v1/admin/catalog/product-imports` (UC-CAT-16). */
export class ProductImportQueryDto {
  /** Valida el archivo y responde el resumen sin guardar nada. */
  @ApiPropertyOptional({ type: Boolean, default: false })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  dryRun?: boolean;
}

/** What a bulk import of products did, or would do with `dryRun` (API_SPEC.md §11.11, ADR-0164). */
export class ProductImportSummaryDto {
  /** Filas del archivo, sin el encabezado: una por variante. */
  rows: number;

  /** Productos creados, en borrador. */
  products: number;

  /** Variantes creadas, una por fila. */
  variants: number;

  /** `true` si solo se validó el archivo, sin guardar productos. */
  dryRun: boolean;
}
