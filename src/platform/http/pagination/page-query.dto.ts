import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import type { PageRequest } from '../../../shared-kernel/index.js';

/** Largest page a client can ask for (ADR-0036); a larger `pageSize` is a validation error. */
export const MAX_PAGE_SIZE = 100;

/**
 * `page` and `pageSize` of a listing (ADR-0036). Each listing's query DTO extends it and adds its declared
 * filters and `sort`; any other query parameter is rejected by the validation pipe.
 */
export class PageQueryDto implements PageRequest {
  /**
   * Página, desde 1.
   * @example 1
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  /**
   * Resultados por página, de 1 a 100.
   * @example 20
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize: number = 20;
}

/** Counts of a listing response (ADR-0036). */
export class PageMetaDto {
  /** @example 1 */
  page: number;

  /** @example 20 */
  pageSize: number;

  /**
   * Resultados de todas las páginas.
   * @example 57
   */
  totalItems: number;

  /** @example 3 */
  totalPages: number;
}
