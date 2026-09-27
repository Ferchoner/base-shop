import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/** Test-only DTO: its OpenAPI schema comes from the Swagger plugin, without @ApiProperty. */
export class CreateSampleItemDto {
  /** Nombre visible del artículo. */
  @IsString()
  @MaxLength(80)
  name: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsString()
  note?: string;
}
