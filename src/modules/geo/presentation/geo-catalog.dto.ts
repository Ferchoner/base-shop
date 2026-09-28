import { ApiProperty } from '@nestjs/swagger';

// Primitive fields are documented by the Swagger plugin from their types and comments. Fields that hold
// other DTOs declare their type with @ApiProperty: the plugin resolves them only with the type checker, as
// in `nest build`, not in the tests (DEVELOPMENT_GUIDE.md).

export class GeoStateDto {
  /**
   * Clave del INEGI, 2 dígitos.
   * @example '16'
   */
  code: string;

  /** @example 'Michoacán de Ocampo' */
  name: string;
}

export class GeoStateListDto {
  @ApiProperty({
    type: () => [GeoStateDto],
    description: 'Las 32 entidades federativas, ordenadas por nombre.',
  })
  data: GeoStateDto[];
}

export class GeoMunicipalityDto {
  /**
   * Clave del INEGI, 5 dígitos: los 2 del estado y los 3 del municipio.
   * @example '16053'
   */
  code: string;

  /** @example 'Morelia' */
  name: string;
}

export class GeoMunicipalityListDto {
  @ApiProperty({
    type: () => [GeoMunicipalityDto],
    description: 'Municipios activos del estado, ordenados por nombre.',
  })
  data: GeoMunicipalityDto[];
}
