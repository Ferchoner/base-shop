import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

// Plain fields are documented by the Swagger plugin; enums and constants declare their type with
// @ApiProperty (ADR-0109, ADR-0112).

/** Emails are compared in lowercase and without surrounding spaces (BR-USR-01). */
const toNormalizedEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

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
