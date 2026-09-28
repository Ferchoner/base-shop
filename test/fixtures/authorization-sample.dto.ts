import { IsOptional, IsString } from 'class-validator';
import { PageQueryDto } from '../../src/platform/http/pagination/page-query.dto.js';
import { IsSortOf } from '../../src/platform/http/pagination/pagination.js';

/** Query of the test-only listing: pagination, one filter and two sortable fields (ADR-0036). */
export class SampleListQueryDto extends PageQueryDto {
  /** Texto a buscar en el nombre. */
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsSortOf(['name', 'createdAt'])
  sort?: string;
}
