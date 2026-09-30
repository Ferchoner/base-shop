import { ApiProperty } from '@nestjs/swagger';

// Plain string and number fields are documented by the Swagger plugin from their types and comments; lists
// of other DTOs declare their type with @ApiProperty (DEVELOPMENT_GUIDE.md).

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
