import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

// Plain fields are documented by the Swagger plugin; enums and constants declare their type with
// @ApiProperty (ADR-0109, ADR-0112).

/** Emails are compared in lowercase and without surrounding spaces (BR-USR-01). */
export const toNormalizedEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export const NOT_BLANK = { context: { message: 'No puede estar vacío.' } };

/** `POST /v1/auth/login` (API_SPEC.md §9.5). */
export class LoginDto {
  /** @example 'cliente@example.com' */
  @Transform(toNormalizedEmail)
  @IsEmail()
  @MaxLength(254)
  email: string;

  /**
   * Up to 64 characters, the most the password policy allows (ADR-0047).
   * @example 'una frase larga y segura'
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  password: string;
}

/** `POST /v1/auth/refresh` and `POST /v1/auth/logout` (API_SPEC.md §9.6, §9.7). */
export class RefreshTokenDto {
  /** @example 'rt_2Qm9…' */
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  refreshToken: string;
}

/** `AuthResult` (API_SPEC.md §8.11): a named object, so a second factor can be added compatibly (ADR-0048). */
export class AuthResultDto {
  @ApiProperty({ enum: ['AUTHENTICATED'], example: 'AUTHENTICATED' })
  outcome: 'AUTHENTICATED';

  /** @example 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…' */
  accessToken: string;

  /**
   * Seconds until the access token expires.
   * @example 900
   */
  accessTokenExpiresIn: number;

  /** @example 'rt_2Qm9…' */
  refreshToken: string;

  /**
   * Seconds until the refresh token expires unless it is used first.
   * @example 604800
   */
  refreshTokenExpiresIn: number;

  @ApiProperty({ enum: ['Bearer'], example: 'Bearer' })
  tokenType: 'Bearer';

  /** Staff with a temporary password: the token only allows `GET /v1/me`, `POST /v1/me/password` and logout. */
  mustChangePassword: boolean;
}

/** `POST /v1/auth/register` (API_SPEC.md §9.2, UC-IAM-01). */
export class RegisterDto {
  /**
   * Se guarda en minúsculas.
   * @example 'cliente@example.com'
   */
  @Transform(toNormalizedEmail)
  @IsEmail()
  @MaxLength(254)
  email: string;

  /**
   * 15 a 64 caracteres y no una contraseña común (ADR-0047). La política responde `password-policy-violation`.
   * @example 'una frase larga y segura'
   */
  @IsString()
  password: string;

  /** @example 'María' */
  @IsString()
  @Length(1, 100)
  @Matches(/\S/, NOT_BLANK)
  firstNames: string;

  /** @example 'López Hernández' */
  @IsString()
  @Length(1, 100)
  @Matches(/\S/, NOT_BLANK)
  lastNames: string;

  /**
   * Versión del aviso de privacidad que se mostró al registrarse (ADR-0067).
   * @example '2026-09'
   */
  @IsString()
  @Length(1, 50)
  @Matches(/\S/, NOT_BLANK)
  privacyNoticeVersion: string;
}

/** `POST /v1/auth/email-verification/confirm` (API_SPEC.md §9.3). */
export class ConfirmEmailDto {
  /** El token del enlace. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  token: string;
}

/** `POST /v1/auth/email-verification/resend` (API_SPEC.md §9.4). */
export class ResendEmailVerificationDto {
  /** @example 'cliente@example.com' */
  @Transform(toNormalizedEmail)
  @IsEmail()
  @MaxLength(254)
  email: string;
}

export class EmailVerifiedDto {
  @ApiProperty({ enum: [true], example: true })
  emailVerified: true;
}

/** `POST /v1/auth/password-reset/request` (API_SPEC.md §9.8, UC-IAM-07). */
export class PasswordResetRequestDto {
  /** @example 'cliente@example.com' */
  @Transform(toNormalizedEmail)
  @IsEmail()
  @MaxLength(254)
  email: string;
}

/** `POST /v1/auth/password-reset/confirm` (API_SPEC.md §9.9, UC-IAM-08). */
export class PasswordResetConfirmDto {
  /** El token del enlace. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  token: string;

  /**
   * 15 a 64 caracteres y no una contraseña común (ADR-0047). La política responde `password-policy-violation`.
   * @example 'una frase nueva y segura'
   */
  @IsString()
  newPassword: string;
}
