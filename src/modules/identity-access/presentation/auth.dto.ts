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

/**
 * The longest password a request may carry, as typed. The policy counts at most 64 characters after normalizing to
 * NFKC (ADR-0115); a password typed in a decomposed form, such as NFD, takes up to four times as many (T-310).
 */
export const PASSWORD_INPUT_MAX_LENGTH = 256;

// Plain fields are documented by the Swagger plugin; enums and constants declare their type with
// @ApiProperty (ADR-0109, ADR-0112).

/** Emails are compared in lowercase and without surrounding spaces (BR-USR-01). */
export const toNormalizedEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export const NOT_BLANK = { context: { message: 'No puede estar vacío.' } };

/** `POST /v1/auth/login` (API_SPEC.md §9.5). */
export class LoginDto {
  /**
   * Email de la cuenta, sin distinguir mayúsculas.
   * @example 'cliente@example.com'
   */
  @Transform(toNormalizedEmail)
  @IsEmail()
  @MaxLength(254)
  email: string;

  /**
   * Hasta 256 caracteres tal como se escribe; la política cuenta 64 después de normalizar a NFKC (ADR-0115).
   * @example 'una frase larga y segura'
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_INPUT_MAX_LENGTH)
  password: string;
}

/** `POST /v1/auth/refresh` and `POST /v1/auth/logout` (API_SPEC.md §9.6, §9.7). */
export class RefreshTokenDto {
  /**
   * El refresh token de la sesión, recibido al iniciarla o al renovarla.
   * @example 'rt_2Qm9…'
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  refreshToken: string;
}

/** `AuthResult` (API_SPEC.md §8.11): a named object, so a second factor can be added compatibly (ADR-0048). */
export class AuthResultDto {
  /**
   * Cómo terminó el inicio de sesión. Hoy siempre `AUTHENTICATED`; un segundo factor agregaría otro resultado
   * (ADR-0048).
   */
  @ApiProperty({ enum: ['AUTHENTICATED'], example: 'AUTHENTICATED' })
  outcome: 'AUTHENTICATED';

  /**
   * Token de acceso (JWT) para el encabezado `Authorization: Bearer`.
   * @example 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…'
   */
  accessToken: string;

  /**
   * Segundos hasta que vence el token de acceso.
   * @example 900
   */
  accessTokenExpiresIn: number;

  /**
   * Token para renovar la sesión con `POST /v1/auth/refresh`. Cada renovación entrega otro y el usado deja de servir;
   * presentar uno usado revoca la sesión (ADR-0023).
   * @example 'rt_2Qm9…'
   */
  refreshToken: string;

  /**
   * Segundos hasta que vence el refresh token, si no se usa antes.
   * @example 604800
   */
  refreshTokenExpiresIn: number;

  /** Esquema del encabezado `Authorization`. */
  @ApiProperty({ enum: ['Bearer'], example: 'Bearer' })
  tokenType: 'Bearer';

  /** Staff con contraseña temporal: el token solo permite `GET /v1/me`, `POST /v1/me/password` y cerrar sesión. */
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

  /**
   * Nombres, de 1 a 100 caracteres.
   * @example 'María'
   */
  @IsString()
  @Length(1, 100)
  @Matches(/\S/, NOT_BLANK)
  firstNames: string;

  /**
   * Apellidos, de 1 a 100 caracteres.
   * @example 'López Hernández'
   */
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
  /**
   * El token del parámetro `token` del enlace: 43 caracteres en base64url.
   * @example 'q8Xz3Lr0VbN7kT2mWc9YhD4sFj6Ae1Pu5Gi8Ko0RnSv'
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  token: string;
}

/** `POST /v1/auth/email-verification/resend` (API_SPEC.md §9.4). */
export class ResendEmailVerificationDto {
  /**
   * Email de la cuenta por verificar.
   * @example 'cliente@example.com'
   */
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
  /**
   * Email de la cuenta.
   * @example 'cliente@example.com'
   */
  @Transform(toNormalizedEmail)
  @IsEmail()
  @MaxLength(254)
  email: string;
}

/** `POST /v1/auth/password-reset/confirm` (API_SPEC.md §9.9, UC-IAM-08). */
export class PasswordResetConfirmDto {
  /**
   * El token del parámetro `token` del enlace: 43 caracteres en base64url.
   * @example 'q8Xz3Lr0VbN7kT2mWc9YhD4sFj6Ae1Pu5Gi8Ko0RnSv'
   */
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
