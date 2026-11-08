import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
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
  ValidateNested,
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
  COUNT_CLASSES,
  type CountClass,
  GTIN_PATTERN,
  MAX_ALT_TEXT_LENGTH,
  MAX_CATEGORIES_PER_PRODUCT,
  MAX_DESCRIPTION_LENGTH,
  MAX_DIMENSION_CM,
  MAX_IMAGES_PER_PRODUCT,
  MAX_PRODUCT_SLUG_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_WEIGHT_GRAMS,
  PRODUCT_STATUSES,
  SKU_PATTERN,
  SLUG_PATTERN,
  VARIANT_STATUSES,
} from '../application/catalog-limits.js';
import {
  COPY_LANGUAGES,
  COPY_TONES,
  type CopyLanguage,
  type CopyTone,
} from '../application/product-copywriter.js';
import { MAX_COUNT_CLASS_ITEMS } from '../application/set-count-classes.use-case.js';
import { STORE_VISIBILITIES } from '../application/storefront.queries.js';

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
const GTIN_FORMAT = {
  context: { message: 'Debe tener 8, 12, 13 o 14 dígitos.' },
};
const NULLABLE_GTIN = {
  type: String,
  nullable: true,
  example: '7501055363063',
} as const;
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
  @ApiProperty({ format: 'uuid' })
  id: string;

  name: string;
}

export class ImageDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  /** URL absoluta, construida al responder (ADR-0024). */
  url: string;

  /** Texto alternativo; `null` sin él. */
  @ApiProperty({ type: String, nullable: true })
  altText: string | null;

  /** Orden entre las imágenes del producto, desde 1; la primera es la principal. */
  position: number;

  /** Variante que muestra; `null` si es del producto. */
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  variantId: string | null;
}

export class AdminVariantDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  /** @example 'CAM-LIN-AZ-M' */
  sku: string;

  @ApiProperty({
    ...NULLABLE_GTIN,
    description:
      'Código de barras del fabricante (EAN o UPC), como se capturó; `null` si no tiene (ADR-0163).',
  })
  gtin: string | null;

  /** Sus valores de las opciones del producto, por nombre. */
  @ApiProperty(OPTIONS)
  options: Record<string, string>;

  /** `ACTIVE` o `DISCONTINUED`; una descontinuada no se vende. */
  @ApiProperty({ enum: VARIANT_STATUSES })
  status: string;

  /** Gramos; `null` si no se dio. */
  @ApiProperty(NULLABLE_NUMBER)
  weightGrams: number | null;

  /** Centímetros, un decimal; `null` si no se dio. */
  @ApiProperty(NULLABLE_NUMBER)
  lengthCm: number | null;

  /** Centímetros, un decimal; `null` si no se dio. */
  @ApiProperty(NULLABLE_NUMBER)
  widthCm: number | null;

  /** Centímetros, un decimal; `null` si no se dio. */
  @ApiProperty(NULLABLE_NUMBER)
  heightCm: number | null;

  /** SKU y opciones editables: el producto nunca se ha publicado (ADR-0068). */
  editableIdentity: boolean;
}

// --- Look-up by code (API_SPEC.md §11.10, ADR-0163) ---

export class VariantLookupProductDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  /** @example 'Camisa de lino' */
  title: string;

  /** @example 'camisa-de-lino' */
  slug: string;

  /** Solo `PUBLISHED` se vende. */
  @ApiProperty({ enum: PRODUCT_STATUSES })
  status: string;
}

export class VariantLookupDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  /** @example 'CAM-LIN-AZ-M' */
  sku: string;

  @ApiProperty({
    ...NULLABLE_GTIN,
    description: 'Código de barras del fabricante; `null` si no tiene.',
  })
  gtin: string | null;

  /** Sus valores de las opciones del producto, por nombre. */
  @ApiProperty(OPTIONS)
  options: Record<string, string>;

  /** `ACTIVE` o `DISCONTINUED`; una descontinuada no se vende. */
  @ApiProperty({ enum: VARIANT_STATUSES })
  status: string;

  /** Si el código coincidió con su SKU o con su GTIN. */
  @ApiProperty({ enum: ['SKU', 'GTIN'] })
  matchedBy: string;

  @ApiProperty({ type: () => VariantLookupProductDto })
  product: VariantLookupProductDto;
}

export class VariantLookupListDto {
  @ApiProperty({
    type: () => [VariantLookupDto],
    description: 'Las activas primero; vacía si ninguna coincide.',
  })
  data: VariantLookupDto[];
}

export class AdminProductDto {
  @ApiProperty({ format: 'uuid' })
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

  /** `null` sin marca. */
  @ApiProperty({ type: () => NamedReferenceDto, nullable: true })
  brand: NamedReferenceDto | null;

  @ApiProperty({ type: () => [NamedReferenceDto] })
  categories: NamedReferenceDto[];

  /** `DRAFT`, `PUBLISHED` o `ARCHIVED`. */
  @ApiProperty({ enum: PRODUCT_STATUSES })
  status: string;

  @ApiProperty({
    enum: STORE_VISIBILITIES,
    description:
      'Si la tienda lo muestra: `HIDDEN_NO_PRICE` es un producto publicado sin variantes vendibles (activas y con precio vigente), y `STORE_ONLY` uno publicado que solo se vende en la tienda física (ADR-0165).',
  })
  storeVisibility: string;

  /** Si solo se vende en la tienda física, como un servicio: nunca en línea (ADR-0165). */
  storeOnly: boolean;

  /**
   * Si se vende a precio libre: el staff escribe el precio y qué se vendió en cada línea de la venta de mostrador, en
   * lugar de la lista de precios (ADR-0171). Solo un producto `storeOnly`.
   */
  openPrice: boolean;

  @ApiProperty({
    enum: COUNT_CLASSES,
    nullable: true,
    description:
      'Cada cuándo se cuenta (ADR-0173): `A` cada semana, `B` cada mes, `C` cada trimestre; `null` sin clase, que se cuenta como `C`.',
  })
  countClass: string | null;

  @ApiProperty({ type: () => [AdminVariantDto] })
  variants: AdminVariantDto[];

  @ApiProperty({ type: () => [ImageDto] })
  images: ImageDto[];

  /** Desde cuándo está publicado; `null` si no lo está. */
  @ApiProperty(NULLABLE_DATE_TIME)
  publishedAt: Date | null;

  /**
   * Su primera publicación. Desde ella, el slug y las opciones de las variantes no cambian (ADR-0068); `null` si nunca
   * se publicó.
   */
  @ApiProperty(NULLABLE_DATE_TIME)
  firstPublishedAt: Date | null;

  /** Cuándo se archivó; `null` si no está archivado. */
  @ApiProperty(NULLABLE_DATE_TIME)
  archivedAt: Date | null;

  /** Versión para el bloqueo optimista: se envía al cambiarlo. */
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

export class VariantLookupQueryDto {
  /**
   * El código leído o capturado: el SKU, sin distinguir mayúsculas, o el GTIN, con o sin ceros a la izquierda.
   * @example '7501055363063'
   */
  @IsString()
  @Matches(SKU_PATTERN, SKU_FORMAT)
  code: string;
}

export class AdminProductListQueryDto extends PageQueryDto {
  /** Parte del título, de un SKU o de un GTIN, sin distinguir mayúsculas. */
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

  /** Solo los productos de esta marca. */
  @IsOptional()
  @IsUUID('all')
  brandId?: string;

  /** Productos que están directamente en esta categoría. */
  @IsOptional()
  @IsUUID('all')
  categoryId?: string;

  /** `true`: solo los productos que se venden solo en la tienda física; `false`: solo los que se venden también en línea. */
  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  storeOnly?: boolean;

  /** `true`: solo los productos de precio libre (ADR-0171); `false`: solo los de precio de lista. */
  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  openPrice?: boolean;

  @ApiPropertyOptional({
    enum: COUNT_CLASSES,
    description: 'Solo los productos de esta clase de conteo (ADR-0173).',
  })
  @IsOptional()
  @IsIn(COUNT_CLASSES)
  countClass?: CountClass;

  /** `true`: solo los productos con clase de conteo; `false`: solo los que no tienen (ADR-0173). */
  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  hasCountClass?: boolean;

  /**
   * `updatedAt`, `title`, `createdAt` o `publishedAt`, con `-` para orden descendente; `-updatedAt` por
   * defecto.
   */
  @IsOptional()
  @IsSortOf(['updatedAt', 'title', 'createdAt', 'publishedAt'])
  sort?: string;
}

export class CreateProductDto {
  /**
   * De 1 a 200 caracteres.
   * @example 'Camisa de lino'
   */
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

  /** Hasta 10,000 caracteres; opcional. */
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

  /** Si solo se vende en la tienda física, como un servicio (ADR-0165); `false` por defecto. */
  @IsOptional()
  @IsBoolean()
  storeOnly?: boolean;

  /**
   * Si se vende a precio libre en la tienda física (ADR-0171); `false` por defecto. Exige `storeOnly`: si no, 400 en
   * `openPrice` con código `openPriceStoreOnly`.
   */
  @IsOptional()
  @IsBoolean()
  openPrice?: boolean;

  @ApiPropertyOptional({
    enum: COUNT_CLASSES,
    nullable: true,
    description:
      'Cada cuándo se cuenta (ADR-0173); sin ella, o con `null`, el producto queda sin clase y se cuenta como `C`.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsIn(COUNT_CLASSES)
  countClass?: CountClass | null;
}

export class UpdateProductDto {
  /** De 1 a 200 caracteres. */
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

  /** Hasta 10,000 caracteres; `null` la quita. */
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

  /** Solo en la tienda física, o también en línea (ADR-0165); se cambia también publicado. */
  @IsOptional()
  @IsBoolean()
  storeOnly?: boolean;

  /**
   * A precio libre, o al de la lista de precios (ADR-0171); se cambia también publicado. Exige que el producto quede
   * `storeOnly`, y un producto de precio libre no deja de ser `storeOnly` sin quitárselo: si no, 400 en `openPrice` con
   * código `openPriceStoreOnly`. En la misma solicitud, `storeOnly: false` con `openPrice: false` sí se acepta.
   */
  @IsOptional()
  @IsBoolean()
  openPrice?: boolean;

  @ApiPropertyOptional({
    enum: COUNT_CLASSES,
    nullable: true,
    description: 'Cada cuándo se cuenta (ADR-0173); `null` la quita.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsIn(COUNT_CLASSES)
  countClass?: CountClass | null;

  /** Versión leída del producto (bloqueo optimista). */
  @IsInt()
  @Min(1)
  version: number;
}

// --- Images (API_SPEC.md §11.8) ---

export class ImageListDto {
  @ApiProperty({ type: () => [ImageDto] })
  data: ImageDto[];
}

/** Text fields of the multipart upload, next to `file`. */
export class ImageUploadFieldsDto {
  /** Texto alternativo, hasta 200 caracteres. */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_ALT_TEXT_LENGTH)
  altText?: string;

  /** Variante del mismo producto que muestra la imagen. */
  @IsOptional()
  @IsUUID('all')
  variantId?: string;
}

export class UpdateImageDto {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 200,
    description: '`null` lo quita.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(MAX_ALT_TEXT_LENGTH)
  altText?: string | null;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Variante del mismo producto; `null` la quita.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID('all')
  variantId?: string | null;
}

export class ImageOrderDto {
  @ApiProperty({
    type: [String],
    description:
      'Todas las imágenes del producto, cada una una vez, en el nuevo orden.',
  })
  @IsArray()
  @ArrayMaxSize(MAX_IMAGES_PER_PRODUCT)
  @IsUUID('all', { each: true })
  imageIds: string[];
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
    ...NULLABLE_GTIN,
    description:
      'Código de barras del fabricante (EAN o UPC): 8, 12, 13 o 14 dígitos con su dígito verificador; sin repetirse entre variantes activas (ADR-0163). Opcional.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Matches(GTIN_PATTERN, GTIN_FORMAT)
  gtin?: string | null;

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
    ...NULLABLE_GTIN,
    description:
      'Código de barras del fabricante, con las reglas del alta; se puede corregir aunque el producto ya se haya publicado, y `null` lo quita (ADR-0163).',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Matches(GTIN_PATTERN, GTIN_FORMAT)
  gtin?: string | null;

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

  /** Centímetros, mayor que 0, un decimal; `null` lo quita. */
  @ApiPropertyOptional(NULLABLE_NUMBER)
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber(ONE_DECIMAL)
  @Min(0.1)
  @Max(MAX_DIMENSION_CM)
  lengthCm?: number | null;

  /** Centímetros, mayor que 0, un decimal; `null` lo quita. */
  @ApiPropertyOptional(NULLABLE_NUMBER)
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber(ONE_DECIMAL)
  @Min(0.1)
  @Max(MAX_DIMENSION_CM)
  widthCm?: number | null;

  /** Centímetros, mayor que 0, un decimal; `null` lo quita. */
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

/** What the staff asks of the description draft with AI (T-147, ADR-0170). */
export class DescriptionDraftRequestDto {
  @ApiProperty({
    enum: COPY_LANGUAGES,
    example: 'es',
    description: 'Idioma del borrador: `es` (español) o `en` (inglés).',
  })
  @IsIn(COPY_LANGUAGES)
  language: CopyLanguage;

  @ApiPropertyOptional({
    enum: COPY_TONES,
    default: 'neutral',
    description: 'Tono del texto: `neutral`, `friendly` (cercano) o `formal`.',
    example: 'friendly',
  })
  @IsOptional()
  @IsIn(COPY_TONES)
  tone?: CopyTone;
}

/** A draft written by AI from the data of the product. Nothing is saved: the product `PATCH` saves it (ADR-0170). */
export class DescriptionDraftDto {
  /** @example 'Camisa de lino fresca para el verano' */
  title: string;

  /** Texto plano, sin Markdown. @example 'Una camisa ligera de lino para los días de calor.' */
  description: string;

  @ApiProperty({
    type: [String],
    example: ['Lino', 'Tallas M y L'],
    description: 'De 3 a 5 puntos destacados del producto.',
  })
  highlights: string[];
}

/** One product of `PUT /v1/admin/catalog/count-classes` (ADR-0173). */
export class CountClassItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('all')
  productId: string;

  @ApiProperty({
    enum: COUNT_CLASSES,
    nullable: true,
    description: '`null` le quita la clase.',
  })
  @ValidateIf((_, value) => value !== null)
  @IsIn(COUNT_CLASSES)
  countClass: CountClass | null;
}

/** `PUT /v1/admin/catalog/count-classes` (ADR-0173): the count class of several products at once. */
export class CountClassesDto {
  @ApiProperty({
    type: () => [CountClassItemDto],
    description: 'De 1 a 500 productos, cada uno una vez.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_COUNT_CLASS_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => CountClassItemDto)
  items: CountClassItemDto[];
}

export class CountClassesResultDto {
  /** Productos cuya clase cambió; los que ya la tenían no cuentan. @example 12 */
  updated: number;
}
