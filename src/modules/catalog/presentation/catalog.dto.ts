import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateBy,
  type ValidationArguments,
} from 'class-validator';
import { MoneyDto } from '../../../platform/http/money.dto.js';
import {
  PageMetaDto,
  PageQueryDto,
} from '../../../platform/http/pagination/page-query.dto.js';
import { CommaSeparated } from '../../../platform/http/pagination/pagination.js';
import { MAX_MONEY_AMOUNT } from '../../../shared-kernel/index.js';
import { MAX_SLUG_LENGTH } from '../application/catalog-limits.js';
import { STOREFRONT_SORTS } from '../application/storefront.queries.js';
import { ImageDto } from './catalog-product.dto.js';

// Plain string and number fields are documented by the Swagger plugin from their types and comments; lists
// of other DTOs declare their type with @ApiProperty (DEVELOPMENT_GUIDE.md).

/** Most brands the store listing filters by at once (API_SPEC.md §11.2). */
const MAX_BRAND_FILTERS = 20;

/** A visible category of the store, with its visible subcategories (API_SPEC.md §11.4). */
export class PublicCategoryDto {
  id: string;

  /** @example 'Camisas' */
  name: string;

  /** @example 'camisas' */
  slug: string;

  /** Orden entre sus hermanas; los empates van por nombre. */
  position: number;

  @ApiProperty({ type: () => [PublicCategoryDto] })
  children: PublicCategoryDto[];
}

export class PublicCategoryTreeDto {
  @ApiProperty({ type: () => [PublicCategoryDto] })
  data: PublicCategoryDto[];
}

/** `relevance` orders by how well each product matches `q`, so it needs one (API_SPEC.md §11.2). */
function RelevanceNeedsSearch(): PropertyDecorator {
  return ValidateBy(
    {
      name: 'relevanceNeedsQ',
      validator: {
        validate: (value: unknown, args: ValidationArguments) =>
          value !== 'relevance' ||
          (args.object as StoreProductListQueryDto).q !== undefined,
        defaultMessage: () => '$property relevance needs q',
      },
    },
    {
      context: {
        message: 'Solo se ordena por relevancia con un texto de búsqueda (q).',
      },
    },
  );
}

/** `maxPrice` cannot be below `minPrice` (API_SPEC.md §11.2). */
function NotBelowMinPrice(): PropertyDecorator {
  return ValidateBy(
    {
      name: 'priceRange',
      validator: {
        validate: (value: unknown, args: ValidationArguments) => {
          const { minPrice } = args.object as StoreProductListQueryDto;
          // A `minPrice` that is not a whole number already has its own error.
          return (
            !Number.isInteger(minPrice) ||
            (value as number) >= (minPrice as number)
          );
        },
        defaultMessage: () => '$property is below minPrice',
      },
    },
    { context: { message: 'Debe ser mayor o igual que minPrice.' } },
  );
}

/** Query of `GET /v1/catalog/products` (UC-CAT-01, API_SPEC.md §11.2, ADR-0060). */
export class StoreProductListQueryDto extends PageQueryDto {
  /**
   * Búsqueda en español, sin acentos y por inicio de palabra, sobre el título, la marca y las categorías.
   * @example 'camisa lino'
   */
  @IsOptional()
  @IsString()
  @Length(2, 100)
  q?: string;

  /**
   * Slug de una categoría visible; incluye sus subcategorías visibles.
   * @example 'camisas'
   */
  @IsOptional()
  @IsString()
  @Length(1, MAX_SLUG_LENGTH)
  category?: string;

  @ApiPropertyOptional({
    type: String,
    description: `Hasta ${MAX_BRAND_FILTERS} slugs de marcas activas, separados por comas.`,
    example: 'marca-uno,marca-dos',
  })
  @IsOptional()
  @CommaSeparated()
  @ArrayMaxSize(MAX_BRAND_FILTERS)
  @IsString({ each: true })
  @Length(1, MAX_SLUG_LENGTH, { each: true })
  brand?: string[];

  /** Precio mínimo del producto, en centavos con IVA incluido. */
  // Decorators run from the bottom up: first that it is a whole number, then its range.
  @IsOptional()
  @Type(() => Number)
  @Max(MAX_MONEY_AMOUNT)
  @Min(0)
  @IsInt()
  minPrice?: number;

  /** Precio máximo del producto, en centavos con IVA incluido; no menor que `minPrice`. */
  // Compared with `minPrice` last, once it is a whole number in range.
  @NotBelowMinPrice()
  @IsOptional()
  @Type(() => Number)
  @Max(MAX_MONEY_AMOUNT)
  @Min(0)
  @IsInt()
  maxPrice?: number;

  /** `true`: solo productos con alguna variante disponible. */
  @ApiPropertyOptional({ type: Boolean, default: false })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  available?: boolean;

  @ApiPropertyOptional({
    enum: STOREFRONT_SORTS,
    description:
      '`relevance` solo con `q`. Por defecto, `relevance` con `q` y `-publishedAt` sin él.',
  })
  @IsOptional()
  @IsIn(STOREFRONT_SORTS)
  @RelevanceNeedsSearch()
  sort?: (typeof STOREFRONT_SORTS)[number];
}

/** The brand of a product in the store, even when inactive (ADR-0080). */
export class StoreBrandDto {
  id: string;

  /** @example 'Marca' */
  name: string;

  /** @example 'marca' */
  slug: string;
}

/** `ProductSummary` of API_SPEC.md §8.4. */
export class ProductSummaryDto {
  id: string;

  /** @example 'camisa-lino-azul' */
  slug: string;

  /** @example 'Camisa de lino' */
  title: string;

  @ApiProperty({ type: () => StoreBrandDto, nullable: true })
  brand: StoreBrandDto | null;

  /** Precio más bajo entre sus variantes vendibles (BR-PRD-15). */
  @ApiProperty({ type: () => MoneyDto })
  fromPrice: MoneyDto;

  @ApiProperty({
    type: () => MoneyDto,
    nullable: true,
    description: 'Precio de comparación de esa misma variante.',
  })
  compareAtPrice: MoneyDto | null;

  /** Alguna variante vendible está disponible (ADR-0061). */
  available: boolean;

  @ApiProperty({ type: () => ImageDto, nullable: true })
  image: ImageDto | null;

  @ApiProperty({ type: String, format: 'date-time' })
  publishedAt: Date;
}

export class ProductSummaryListDto {
  @ApiProperty({ type: () => [ProductSummaryDto] })
  data: ProductSummaryDto[];

  @ApiProperty({ type: () => PageMetaDto })
  meta: PageMetaDto;
}

export class StoreCategoryDto {
  id: string;

  /** @example 'Camisas' */
  name: string;

  /** @example 'camisas' */
  slug: string;
}

/** A sellable variant (BR-PRD-11): only whether it is available, never its units (ADR-0061). */
export class StoreVariantDto {
  id: string;

  /** @example 'CAM-LIN-AZ-M' */
  sku: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    example: { talla: 'M', color: 'Azul' },
  })
  options: Record<string, string>;

  @ApiProperty({ type: () => MoneyDto })
  price: MoneyDto;

  @ApiProperty({ type: () => MoneyDto, nullable: true })
  compareAtPrice: MoneyDto | null;

  available: boolean;
}

/** `ProductDetail` of API_SPEC.md §8.5. */
export class ProductDetailDto extends ProductSummaryDto {
  @ApiProperty({ type: String, nullable: true })
  description: string | null;

  /** Solo categorías visibles (ADR-0080). */
  @ApiProperty({ type: () => [StoreCategoryDto] })
  categories: StoreCategoryDto[];

  @ApiProperty({ type: () => [ImageDto] })
  images: ImageDto[];

  @ApiProperty({ type: [String], example: ['color', 'talla'] })
  optionNames: string[];

  /** Solo variantes vendibles, de la más antigua a la más nueva. */
  @ApiProperty({ type: () => [StoreVariantDto] })
  variants: StoreVariantDto[];
}

export class StoreBrandListDto {
  @ApiProperty({ type: () => [StoreBrandDto] })
  data: StoreBrandDto[];
}
