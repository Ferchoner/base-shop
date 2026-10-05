import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import type { PageRequest } from '../../../shared-kernel/index.js';

/** Largest page a client can ask for (ADR-0036); a larger `pageSize` is a validation error. */
export const MAX_PAGE_SIZE = 100;

/**
 * Last page a client can ask for: far beyond any listing, and below the offsets the database accepts, so a huge
 * `page` is a validation error and not a 500 (T-310).
 */
export const MAX_PAGE = 1_000_000;

/**
 * `page` and `pageSize` of a listing (ADR-0036). Each listing's query DTO extends it and adds its declared
 * filters and `sort`; any other query parameter is rejected by the validation pipe. `@ApiPropertyOptional` keeps
 * the Swagger plugin from marking required a field that has a default.
 */
export class PageQueryDto implements PageRequest {
  /**
   * Página, de 1 a 1,000,000.
   * @example 1
   */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  page: number = 1;

  /**
   * Resultados por página, de 1 a 100.
   * @example 20
   */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize: number = 20;
}

/** Counts of a listing response (ADR-0036). */
export class PageMetaDto {
  /**
   * La página de esta respuesta, desde 1.
   * @example 1
   */
  page: number;

  /**
   * Elementos por página.
   * @example 20
   */
  pageSize: number;

  /**
   * Resultados de todas las páginas.
   * @example 57
   */
  totalItems: number;

  /**
   * Páginas en total; 0 sin resultados.
   * @example 3
   */
  totalPages: number;
}
