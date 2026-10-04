import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  PERMISSION_CODES,
  type PermissionCode,
} from '../../../shared-kernel/index.js';
import {
  NOT_BLANK,
  PASSWORD_INPUT_MAX_LENGTH,
  toNormalizedEmail,
} from './auth.dto.js';
import { StaffRoleDto } from './identity-admin.dto.js';

// Plain fields are documented by the Swagger plugin; enums, lists and dates declare their type with
// @ApiProperty (ADR-0109, ADR-0112).

/** The signed-in account (`Account`, API_SPEC.md §8.10). */
export class AccountDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  /** `CUSTOMER` o `STAFF` (BR-USR-08). */
  @ApiProperty({ enum: ['CUSTOMER', 'STAFF'] })
  type: 'CUSTOMER' | 'STAFF';

  /** @example 'cliente@example.com' */
  email: string;

  /** @example 'María' */
  firstNames: string;

  /** @example 'López Hernández' */
  lastNames: string;

  /** Si el email ya se verificó; un cliente lo necesita para comprar (BR-USR-05). */
  emailVerified: boolean;

  /** Staff con contraseña temporal, que solo puede cambiarla. */
  mustChangePassword: boolean;

  /** Roles del staff; vacío en un cliente. */
  @ApiProperty({ type: () => [StaffRoleDto] })
  roles: StaffRoleDto[];

  /** Permisos de los roles del staff; vacío en un cliente. */
  @ApiProperty({ type: String, enum: PERMISSION_CODES, isArray: true })
  permissions: PermissionCode[];

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;
}

/** `POST /v1/me/password` (API_SPEC.md §9.12). */
export class ChangePasswordDto {
  /**
   * La contraseña actual; la temporal, en el cambio obligatorio del staff.
   * @example 'una frase larga y segura'
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_INPUT_MAX_LENGTH)
  currentPassword: string;

  /**
   * De 15 a 64 caracteres, no una contraseña común y distinta de la actual (ADR-0047). Si no cumple,
   * `password-policy-violation`.
   * @example 'otra frase larga y distinta'
   */
  @IsString()
  newPassword: string;
}

/** `PATCH /v1/me` (API_SPEC.md §9.11): only the fields sent change; neither accepts `null`. */
export class UpdateAccountDto {
  /**
   * Nombres, de 1 a 100 caracteres; no admite `null`.
   * @example 'María José'
   */
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @Length(1, 100)
  @Matches(/\S/, NOT_BLANK)
  firstNames?: string;

  /**
   * Apellidos, de 1 a 100 caracteres; no admite `null`.
   * @example 'López Hernández'
   */
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @Length(1, 100)
  @Matches(/\S/, NOT_BLANK)
  lastNames?: string;
}

/** `POST /v1/me/email` (API_SPEC.md §9.13, UC-IAM-10). */
export class ChangeEmailDto {
  /**
   * Se guarda en minúsculas y queda sin verificar.
   * @example 'nuevo@example.com'
   */
  @Transform(toNormalizedEmail)
  @IsEmail()
  @MaxLength(254)
  newEmail: string;

  /**
   * La contraseña actual, para confirmar el cambio.
   * @example 'una frase larga y segura'
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_INPUT_MAX_LENGTH)
  currentPassword: string;
}
