import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
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
  CATALOG_STATUSES,
  MAX_NAME_LENGTH,
  MAX_POSITION,
  MAX_SLUG_LENGTH,
  SLUG_PATTERN,
} from '../application/catalog-limits.js';

// Plain string, number and boolean fields are documented by the Swagger plugin from their types and comments.
// Fields holding other DTOs, lists, dates, enums or null declare their type with @ApiProperty (DEVELOPMENT_GUIDE.md).

const NOT_BLANK = { context: { message: 'No puede estar vacío.' } };
const SLUG_FORMAT = {
  context: {
    message:
      'Solo minúsculas sin acentos, dígitos y guiones entre palabras, como camisas-de-vestir.',
  },
};
const DATE_TIME = { type: String, format: 'date-time' } as const;
const STATUS = { enum: CATALOG_STATUSES } as const;
const STATUS_FILTER = {
  type: String,
  description: 'Uno o más estados separados por comas: `ACTIVE`, `INACTIVE`.',
  example: 'ACTIVE',
} as const;

// --- Categories (API_SPEC.md §11.9) ---

export class AdminCategoryDto {
  id: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: '`null` en una categoría raíz.',
  })
  parentId: string | null;

  /** @example 'Camisas' */
  name: string;

  /** @example 'camisas' */
  slug: string;

  @ApiProperty(STATUS)
  status: string;

  /** Orden entre sus hermanas; los empates van por nombre. */
  position: number;

  /** Productos en cualquier estado. */
  productCount: number;

  /** Subcategorías directas, activas o no. */
  childCount: number;

  @ApiProperty(DATE_TIME)
  createdAt: Date;

  @ApiProperty(DATE_TIME)
  updatedAt: Date;
}

export class AdminCategoryNodeDto extends AdminCategoryDto {
  @ApiProperty({ type: () => [AdminCategoryNodeDto] })
  children: AdminCategoryNodeDto[];
}

export class AdminCategoryTreeDto {
  @ApiProperty({ type: () => [AdminCategoryNodeDto] })
  data: AdminCategoryNodeDto[];
}

export class AdminCategoryTreeQueryDto {
  /** Con filtro, el árbol incluye también los ancestros de cada categoría que coincide, con su propio estado. */
  @ApiPropertyOptional(STATUS_FILTER)
  @IsOptional()
  @CommaSeparated()
  @IsIn(CATALOG_STATUSES, { each: true })
  status?: string[];
}

export class CreateCategoryDto {
  /** @example 'Camisas' */
  @IsString()
  @Length(1, MAX_NAME_LENGTH)
  @Matches(/\S/, NOT_BLANK)
  name: string;

  /**
   * Único entre las categorías. Sin él, se genera del nombre y, si ya existe, se numera: `camisas-2`.
   * @example 'camisas'
   */
  @IsOptional()
  @IsString()
  @Length(1, MAX_SLUG_LENGTH)
  @Matches(SLUG_PATTERN, SLUG_FORMAT)
  slug?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Categoría padre activa; sin ella o con `null`, es raíz.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID('all')
  parentId?: string | null;

  /**
   * Orden entre sus hermanas, de 0 a 10000; 0 por defecto.
   * @example 0
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_POSITION)
  position?: number;
}

export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @Length(1, MAX_NAME_LENGTH)
  @Matches(/\S/, NOT_BLANK)
  name?: string;

  /** El anterior deja de funcionar y queda libre (ADR-0072). */
  @IsOptional()
  @IsString()
  @Length(1, MAX_SLUG_LENGTH)
  @Matches(SLUG_PATTERN, SLUG_FORMAT)
  slug?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'Mueve la categoría bajo otra activa, o a la raíz con `null`. No puede quedar bajo sí misma ni bajo sus subcategorías.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID('all')
  parentId?: string | null;

  /** De 0 a 10000. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_POSITION)
  position?: number;
}

// --- Brands (API_SPEC.md §11.9) ---

export class AdminBrandDto {
  id: string;

  /** @example 'Marca' */
  name: string;

  /** @example 'marca' */
  slug: string;

  @ApiProperty(STATUS)
  status: string;

  /** Productos en cualquier estado. */
  productCount: number;

  @ApiProperty(DATE_TIME)
  createdAt: Date;

  @ApiProperty(DATE_TIME)
  updatedAt: Date;
}

export class AdminBrandListDto {
  @ApiProperty({ type: () => [AdminBrandDto] })
  data: AdminBrandDto[];

  @ApiProperty({ type: () => PageMetaDto })
  meta: PageMetaDto;
}

export class AdminBrandListQueryDto extends PageQueryDto {
  /** Parte del nombre, sin distinguir mayúsculas. */
  @IsOptional()
  @IsString()
  @Length(1, MAX_NAME_LENGTH)
  q?: string;

  @ApiPropertyOptional(STATUS_FILTER)
  @IsOptional()
  @CommaSeparated()
  @IsIn(CATALOG_STATUSES, { each: true })
  status?: string[];

  /** `name` (por defecto), con `-` para orden descendente. */
  @IsOptional()
  @IsSortOf(['name'])
  sort?: string;
}

export class CreateBrandDto {
  /** @example 'Marca' */
  @IsString()
  @Length(1, MAX_NAME_LENGTH)
  @Matches(/\S/, NOT_BLANK)
  name: string;

  /**
   * Único entre las marcas. Sin él, se genera del nombre y, si ya existe, se numera: `marca-2`.
   * @example 'marca'
   */
  @IsOptional()
  @IsString()
  @Length(1, MAX_SLUG_LENGTH)
  @Matches(SLUG_PATTERN, SLUG_FORMAT)
  slug?: string;
}

export class UpdateBrandDto {
  @IsOptional()
  @IsString()
  @Length(1, MAX_NAME_LENGTH)
  @Matches(/\S/, NOT_BLANK)
  name?: string;

  /** El anterior deja de funcionar y queda libre (ADR-0072). */
  @IsOptional()
  @IsString()
  @Length(1, MAX_SLUG_LENGTH)
  @Matches(SLUG_PATTERN, SLUG_FORMAT)
  slug?: string;
}
