import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, Matches } from 'class-validator';

// Plain fields are documented by the Swagger plugin; nullable fields declare their type with @ApiProperty
// (ADR-0109, ADR-0112).

const NULLABLE_TEXT = { type: String, nullable: true } as const;
const NOT_BLANK = { context: { message: 'No puede estar vacío.' } };
const PHONE = {
  context: { message: 'Debe tener exactamente 10 dígitos.' },
} as const;
const POSTAL_CODE = { context: { message: 'Debe tener 5 dígitos.' } } as const;
const STATE_CODE = { context: { message: 'Debe tener 2 dígitos.' } } as const;
const MUNICIPALITY_CODE = {
  context: { message: 'Debe tener 5 dígitos.' },
} as const;

/**
 * `AddressInput` of API_SPEC.md §8.2 (ADR-0057, ADR-0071): the format of every address the API receives, such
 * as a customer's (Identity) or the warehouse's (Inventory, ADR-0127). Only the format is checked here; each
 * context checks the state and municipality against the INEGI catalog.
 */
export class AddressInputDto {
  /** Nombre completo de quien recibe. @example 'María López Hernández' */
  @IsString()
  @Length(1, 120)
  @Matches(/\S/, NOT_BLANK)
  recipientName: string;

  /** Exactamente 10 dígitos. @example '4431234567' */
  @Matches(/^[0-9]{10}$/, PHONE)
  phone: string;

  /** @example 'Av. Madero Poniente' */
  @IsString()
  @Length(1, 150)
  @Matches(/\S/, NOT_BLANK)
  street: string;

  /** Admite "S/N" y letras. @example '123' */
  @IsString()
  @Length(1, 20)
  @Matches(/\S/, NOT_BLANK)
  exteriorNumber: string;

  @ApiPropertyOptional({ ...NULLABLE_TEXT, example: '4B' })
  @IsOptional()
  @IsString()
  @Length(1, 20)
  interiorNumber?: string | null;

  /** Colonia. @example 'Centro' */
  @IsString()
  @Length(1, 120)
  @Matches(/\S/, NOT_BLANK)
  neighborhood: string;

  /** 5 dígitos; solo se valida el formato. @example '58000' */
  @Matches(/^[0-9]{5}$/, POSTAL_CODE)
  postalCode: string;

  /** Clave del INEGI del estado. @example '16' */
  @Matches(/^[0-9]{2}$/, STATE_CODE)
  stateCode: string;

  /** Clave del INEGI de un municipio vigente del estado. @example '16053' */
  @Matches(/^[0-9]{5}$/, MUNICIPALITY_CODE)
  municipalityCode: string;

  @ApiPropertyOptional({ ...NULLABLE_TEXT, example: 'Morelia' })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  city?: string | null;

  @ApiPropertyOptional({ ...NULLABLE_TEXT, example: 'Entre Galeana e Hidalgo' })
  @IsOptional()
  @IsString()
  @Length(1, 250)
  references?: string | null;
}

/** `Address` of API_SPEC.md §8.2: the fields of `AddressInput` with the names of the state and municipality. */
export class PostalAddressDto {
  /** @example 'María López Hernández' */
  recipientName: string;

  /** @example '4431234567' */
  phone: string;

  /** @example 'Av. Madero Poniente' */
  street: string;

  /** @example '123' */
  exteriorNumber: string;

  @ApiProperty({ ...NULLABLE_TEXT, example: '4B' })
  interiorNumber: string | null;

  /** @example 'Centro' */
  neighborhood: string;

  /** @example '58000' */
  postalCode: string;

  /** @example '16' */
  stateCode: string;

  /** @example 'Michoacán de Ocampo' */
  stateName: string;

  /** @example '16053' */
  municipalityCode: string;

  /** @example 'Morelia' */
  municipalityName: string;

  @ApiProperty({ ...NULLABLE_TEXT, example: 'Morelia' })
  city: string | null;

  @ApiProperty({ ...NULLABLE_TEXT, example: 'Entre Galeana e Hidalgo' })
  references: string | null;

  /** @example 'MX' */
  country: string;
}
