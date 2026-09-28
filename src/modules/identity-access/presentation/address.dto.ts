import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDefined,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateIf,
} from 'class-validator';

// Plain fields are documented by the Swagger plugin; lists, dates and nullable fields declare their type
// with @ApiProperty (ADR-0109, ADR-0112).

const DATE_TIME = { type: String, format: 'date-time' } as const;
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

/** An address as the API answers it (API_SPEC.md §8.2). */
export class AddressDto {
  id: string;

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

  isDefault: boolean;

  @ApiProperty(DATE_TIME)
  createdAt: Date;

  @ApiProperty(DATE_TIME)
  updatedAt: Date;
}

export class AddressListDto {
  @ApiProperty({
    type: () => [AddressDto],
    description: 'La predeterminada primero, después las más recientes.',
  })
  data: AddressDto[];
}

/** A new address (`AddressInput`, API_SPEC.md §8.2) and whether it becomes the default. */
export class CreateAddressDto {
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

  /** La primera dirección siempre queda como predeterminada. */
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

/**
 * Changes to an address: only the fields sent change. Required fields cannot be `null`; the optional ones
 * are cleared with `null`. Changing `stateCode` requires `municipalityCode` (API_SPEC.md §9.14).
 */
export class UpdateAddressDto {
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @Length(1, 120)
  @Matches(/\S/, NOT_BLANK)
  recipientName?: string;

  @ValidateIf((_, value) => value !== undefined)
  @Matches(/^[0-9]{10}$/, PHONE)
  phone?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @Length(1, 150)
  @Matches(/\S/, NOT_BLANK)
  street?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @Length(1, 20)
  @Matches(/\S/, NOT_BLANK)
  exteriorNumber?: string;

  @ApiPropertyOptional(NULLABLE_TEXT)
  @IsOptional()
  @IsString()
  @Length(1, 20)
  interiorNumber?: string | null;

  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @Length(1, 120)
  @Matches(/\S/, NOT_BLANK)
  neighborhood?: string;

  @ValidateIf((_, value) => value !== undefined)
  @Matches(/^[0-9]{5}$/, POSTAL_CODE)
  postalCode?: string;

  @ValidateIf((_, value) => value !== undefined)
  @Matches(/^[0-9]{2}$/, STATE_CODE)
  stateCode?: string;

  /** Obligatorio si cambia `stateCode`. */
  @ValidateIf(
    (dto: UpdateAddressDto) =>
      dto.stateCode !== undefined || dto.municipalityCode !== undefined,
  )
  @IsDefined({ context: { message: 'Es obligatorio si cambia el estado.' } })
  @Matches(/^[0-9]{5}$/, MUNICIPALITY_CODE)
  municipalityCode?: string;

  @ApiPropertyOptional(NULLABLE_TEXT)
  @IsOptional()
  @IsString()
  @Length(1, 120)
  city?: string | null;

  @ApiPropertyOptional(NULLABLE_TEXT)
  @IsOptional()
  @IsString()
  @Length(1, 250)
  references?: string | null;

  /** `true` la vuelve la predeterminada; `false` deja al cliente sin predeterminada. */
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
