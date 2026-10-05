import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { MAX_PAGE_SIZE } from './page-query.dto.js';

/** Results of a page when the request does not say (API_SPEC.md §5.2). */
export const DEFAULT_CURSOR_LIMIT = 50;

/**
 * `cursor` and `limit` of a listing paginated by cursor (API_SPEC.md §5.2, ADR-0036): for listings that grow
 * without end, such as stock movements or the audit trail. Each listing's query DTO extends it with its
 * filters. `@ApiPropertyOptional` keeps the Swagger plugin from marking `limit` required for its default.
 */
export class CursorQueryDto {
  /** Opaco: el `nextCursor` de la respuesta anterior. Sin él, la primera página. */
  @IsOptional()
  @IsString()
  cursor?: string;

  /**
   * Resultados por página, de 1 a 100.
   * @example 50
   */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit: number = DEFAULT_CURSOR_LIMIT;
}

/** `meta` of a listing response paginated by cursor (API_SPEC.md §5.2). */
export class CursorMetaDto {
  /**
   * Resultados por página que se pidieron.
   * @example 50
   */
  limit: number;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'El cursor de la página siguiente, para enviarlo como `cursor`; `null` en la última.',
    example: 'eyJjcmVhdGVkQXQiOiIyMDI2LTEwLTA1VDEyOjAwOjAwLjAwMFoifQ',
  })
  nextCursor: string | null;
}
