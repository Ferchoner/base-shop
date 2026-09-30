import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
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
import {
  PageMetaDto,
  PageQueryDto,
} from '../../../platform/http/pagination/page-query.dto.js';
import {
  CommaSeparated,
  IsSortOf,
} from '../../../platform/http/pagination/pagination.js';
import {
  MAX_CATEGORIES_PER_PRODUCT,
  MAX_DESCRIPTION_LENGTH,
  MAX_DIMENSION_CM,
  MAX_PRODUCT_SLUG_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_WEIGHT_GRAMS,
  PRODUCT_STATUSES,
  SKU_PATTERN,
  SLUG_PATTERN,
  VARIANT_STATUSES,
} from '../application/catalog-limits.js';

// Plain string, number and boolean fields are documented by the Swagger plugin from their types and comments.
// Fields holding other DTOs, lists, dates, enums, objects or null declare their type with @ApiProperty
// (DEVELOPMENT_GUIDE.md).

const NOT_BLANK = { context: { message: 'No puede estar vacío.' } };
const SLUG_FORMAT = {
  context: {
    message:
      'Solo minúsculas sin acentos, dígitos y guiones entre palabras, como camisa-lino-azul.',
  },
};
const SKU_FORMAT = {
  context: {
    message: 'De 1 a 64 letras, dígitos, "-", "_" y ".".',
  },
};
const DATE_TIME = { type: String, format: 'date-time' } as const;
const NULLABLE_DATE_TIME = { ...DATE_TIME, nullable: true } as const;
const NULLABLE_NUMBER = { type: Number, nullable: true } as const;
const OPTIONS = {
  type: 'object',
  additionalProperties: { type: 'string' },
  example: { talla: 'M', color: 'Azul' },
} as const;
const ONE_DECIMAL = { maxDecimalPlaces: 1 };

// --- Responses (API_SPEC.md §8.3 and §11.6) ---

export class NamedReferenceDto {
  id: string;

  name: string;
}

export class ImageDto {
  id: string;

  /** URL absoluta, construida al responder (ADR-0024). */
  url: string;

  @ApiProperty({ type: String, nullable: true })
  altText: string | null;

  position: number;

  @ApiProperty({ type: String, nullable: true })
  variantId: string | null;
}

export class AdminVariantDto {
  id: string;

  /** @example 'CAM-LIN-AZ-M' */
  sku: string;

  @ApiProperty(OPTIONS)
  options: Record<string, string>;

  @ApiProperty({ enum: VARIANT_STATUSES })
  status: string;

  @ApiProperty(NULLABLE_NUMBER)
  weightGrams: number | null;

  @ApiProperty(NULLABLE_NUMBER)
  lengthCm: number | null;

  @ApiProperty(NULLABLE_NUMBER)
  widthCm: number | null;

  @ApiProperty(NULLABLE_NUMBER)
  heightCm: number | null;

  /** SKU y opciones editables: el producto nunca se ha publicado (ADR-0068). */
  editableIdentity: boolean;
}

export class AdminProductDto {
  id: string;

  /** @example 'Camisa de lino' */
  title: string;

  /** @example 'camisa-lino' */
  slug: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Solo en el detalle; el listado no la incluye.',
  })
  description?: string | null;

  @ApiProperty({ type: () => NamedReferenceDto, nullable: true })
  brand: NamedReferenceDto | null;

  @ApiProperty({ type: () => [NamedReferenceDto] })
  categories: NamedReferenceDto[];

  @ApiProperty({ enum: PRODUCT_STATUSES })
  status: string;

  @ApiProperty({ type: () => [AdminVariantDto] })
  variants: AdminVariantDto[];

  @ApiProperty({ type: () => [ImageDto] })
  images: ImageDto[];

  @ApiProperty(NULLABLE_DATE_TIME)
  publishedAt: Date | null;

  @ApiProperty(NULLABLE_DATE_TIME)
  firstPublishedAt: Date | null;

  @ApiProperty(NULLABLE_DATE_TIME)
  archivedAt: Date | null;

  version: number;

  @ApiProperty(DATE_TIME)
  createdAt: Date;

  @ApiProperty(DATE_TIME)
  updatedAt: Date;
}

export class AdminProductListDto {
  @ApiProperty({ type: () => [AdminProductDto] })
  data: AdminProductDto[];

  @ApiProperty({ type: () => PageMetaDto })
  meta: PageMetaDto;
}

// --- Requests ---

export class AdminProductListQueryDto extends PageQueryDto {
  /** Parte del título o de un SKU, sin distinguir mayúsculas. */
  @IsOptional()
  @IsString()
  @Length(1, 100)
  q?: string;

  @ApiPropertyOptional({
    type: String,
    description:
      'Uno o más estados separados por comas: `DRAFT`, `PUBLISHED`, `ARCHIVED`.',
    example: 'PUBLISHED',
  })
  @IsOptional()
  @CommaSeparated()
  @IsIn(PRODUCT_STATUSES, { each: true })
  status?: string[];

  @IsOptional()
  @IsUUID('all')
  brandId?: string;

  /** Productos que están directamente en esta categoría. */
  @IsOptional()
  @IsUUID('all')
  categoryId?: string;

  /**
   * `updatedAt`, `title`, `createdAt` o `publishedAt`, con `-` para orden descendente; `-updatedAt` por
   * defecto.
   */
  @IsOptional()
  @IsSortOf(['updatedAt', 'title', 'createdAt', 'publishedAt'])
  sort?: string;
}

export class CreateProductDto {
  /** @example 'Camisa de lino' */
  @IsString()
  @Length(1, MAX_TITLE_LENGTH)
  @Matches(/\S/, NOT_BLANK)
  title: string;

  /**
   * Único y nunca reutilizado. Sin él, se genera del título y, si ya existe, se numera: `camisa-lino-2`.
   * @example 'camisa-lino'
   */
  @IsOptional()
  @IsString()
  @Length(1, MAX_PRODUCT_SLUG_LENGTH)
  @Matches(SLUG_PATTERN, SLUG_FORMAT)
  slug?: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 10_000 })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(MAX_DESCRIPTION_LENGTH)
  description?: string | null;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Marca activa.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID('all')
  brandId?: string | null;

  @ApiPropertyOptional({
    type: [String],
    description: 'Categorías activas, hasta 10.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_CATEGORIES_PER_PRODUCT)
  @IsUUID('all', { each: true })
  categoryIds?: string[];
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @Length(1, MAX_TITLE_LENGTH)
  @Matches(/\S/, NOT_BLANK)
  title?: string;

  /** Solo mientras el producto nunca se ha publicado (ADR-0068). */
  @IsOptional()
  @IsString()
  @Length(1, MAX_PRODUCT_SLUG_LENGTH)
  @Matches(SLUG_PATTERN, SLUG_FORMAT)
  slug?: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 10_000 })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(MAX_DESCRIPTION_LENGTH)
  description?: string | null;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Una marca nueva debe estar activa; `null` quita la marca.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID('all')
  brandId?: string | null;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Reemplaza las categorías, hasta 10. Las nuevas deben estar activas; las que ya tenía se conservan aunque se hayan desactivado.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_CATEGORIES_PER_PRODUCT)
  @IsUUID('all', { each: true })
  categoryIds?: string[];

  /** Versión leída del producto (bloqueo optimista). */
  @IsInt()
  @Min(1)
  version: number;
}

export class ProductVersionDto {
  /** Versión leída del producto (bloqueo optimista). */
  @IsInt()
  @Min(1)
  version: number;
}

export class CreateVariantDto {
  /**
   * Se guarda en mayúsculas; único y nunca reutilizado (BR-PRD-09).
   * @example 'CAM-LIN-AZ-M'
   */
  @IsString()
  @Matches(SKU_PATTERN, SKU_FORMAT)
  sku: string;

  @ApiPropertyOptional({
    ...OPTIONS,
    description:
      'Hasta 3 opciones: nombres de 1 a 30 caracteres, en minúsculas; valores de 1 a 50. Las mismas opciones que las demás variantes del producto.',
  })
  @IsOptional()
  @IsObject()
  options?: Record<string, unknown>;

  @ApiPropertyOptional({
    ...NULLABLE_NUMBER,
    description: 'Gramos, entero mayor que 0.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(MAX_WEIGHT_GRAMS)
  weightGrams?: number | null;

  @ApiPropertyOptional({
    ...NULLABLE_NUMBER,
    description: 'Centímetros, mayor que 0, un decimal.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber(ONE_DECIMAL)
  @Min(0.1)
  @Max(MAX_DIMENSION_CM)
  lengthCm?: number | null;

  @ApiPropertyOptional({
    ...NULLABLE_NUMBER,
    description: 'Centímetros, mayor que 0, un decimal.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber(ONE_DECIMAL)
  @Min(0.1)
  @Max(MAX_DIMENSION_CM)
  widthCm?: number | null;

  @ApiPropertyOptional({
    ...NULLABLE_NUMBER,
    description: 'Centímetros, mayor que 0, un decimal.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber(ONE_DECIMAL)
  @Min(0.1)
  @Max(MAX_DIMENSION_CM)
  heightCm?: number | null;

  /** Versión leída del producto (bloqueo optimista). */
  @IsInt()
  @Min(1)
  version: number;
}

export class UpdateVariantDto {
  /** Solo mientras el producto nunca se ha publicado; el anterior queda libre (ADR-0068). */
  @IsOptional()
  @IsString()
  @Matches(SKU_PATTERN, SKU_FORMAT)
  sku?: string;

  @ApiPropertyOptional({
    ...OPTIONS,
    description: 'Solo mientras el producto nunca se ha publicado (ADR-0068).',
  })
  @IsOptional()
  @IsObject()
  options?: Record<string, unknown>;

  @ApiPropertyOptional({ ...NULLABLE_NUMBER, description: '`null` lo quita.' })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(MAX_WEIGHT_GRAMS)
  weightGrams?: number | null;

  @ApiPropertyOptional(NULLABLE_NUMBER)
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber(ONE_DECIMAL)
  @Min(0.1)
  @Max(MAX_DIMENSION_CM)
  lengthCm?: number | null;

  @ApiPropertyOptional(NULLABLE_NUMBER)
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber(ONE_DECIMAL)
  @Min(0.1)
  @Max(MAX_DIMENSION_CM)
  widthCm?: number | null;

  @ApiPropertyOptional(NULLABLE_NUMBER)
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber(ONE_DECIMAL)
  @Min(0.1)
  @Max(MAX_DIMENSION_CM)
  heightCm?: number | null;

  /** Versión leída del producto (bloqueo optimista). */
  @IsInt()
  @Min(1)
  version: number;
}
