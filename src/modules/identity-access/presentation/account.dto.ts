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
  id: string;

  @ApiProperty({ enum: ['CUSTOMER', 'STAFF'] })
  type: 'CUSTOMER' | 'STAFF';

  /** @example 'cliente@example.com' */
  email: string;

  /** @example 'María' */
  firstNames: string;

  /** @example 'López Hernández' */
  lastNames: string;

  emailVerified: boolean;

  /** Staff with a temporary password, who may only change it. */
  mustChangePassword: boolean;

  /** Staff roles; always empty for customers. */
  @ApiProperty({ type: () => [StaffRoleDto] })
  roles: StaffRoleDto[];

  /** Permissions of the staff member's roles; always empty for customers. */
  @ApiProperty({ type: String, enum: PERMISSION_CODES, isArray: true })
  permissions: PermissionCode[];

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;
}

/** `POST /v1/me/password` (API_SPEC.md §9.12). */
export class ChangePasswordDto {
  /**
   * The current password; the temporary one for staff who must change it.
   * @example 'una frase larga y segura'
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_INPUT_MAX_LENGTH)
  currentPassword: string;

  /**
   * 15 to 64 characters, not a common password and not the current one (ADR-0047). Checked by the password
   * policy, which answers `password-policy-violation`.
   * @example 'otra frase larga y distinta'
   */
  @IsString()
  newPassword: string;
}

/** `PATCH /v1/me` (API_SPEC.md §9.11): only the fields sent change; neither accepts `null`. */
export class UpdateAccountDto {
  /** @example 'María José' */
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @Length(1, 100)
  @Matches(/\S/, NOT_BLANK)
  firstNames?: string;

  /** @example 'López Hernández' */
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

  /** @example 'una frase larga y segura' */
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_INPUT_MAX_LENGTH)
  currentPassword: string;
}
