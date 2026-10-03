import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsInt,
  IsString,
  Length,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

// Plain string, number and boolean fields are documented by the Swagger plugin from their types and comments; dates
// declare their type with @ApiProperty (DEVELOPMENT_GUIDE.md).

const NOT_BLANK = { context: { message: 'No puede estar vacío.' } };

/** Emails are compared in lowercase and without surrounding spaces, as the order keeps them. */
const toNormalizedEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/** The reference of the request (BR-PRIV-02), which stays in the audit trail of every change. */
class AnonymizationReasonDto {
  /**
   * Referencia de la solicitud ARCO, de 1 a 250 caracteres. Queda en la auditoría: no escribas datos personales.
   * @example 'ARCO-2026-0042'
   */
  @IsString()
  @Length(1, 250)
  @Matches(/\S/, NOT_BLANK)
  reason: string;
}

/** Request of `POST /v1/admin/identity/customers/{userId}/anonymize` (API_SPEC.md §9.18). */
export class AnonymizeCustomerDto extends AnonymizationReasonDto {
  /** Versión leída del cliente (bloqueo optimista). */
  @IsInt()
  @Min(1)
  version: number;
}

/** Response of `POST /v1/admin/identity/customers/{userId}/anonymize` (API_SPEC.md §9.18). */
export class CustomerAnonymizationDto {
  userId: string;

  @ApiProperty({ type: String, format: 'date-time' })
  anonymizedAt: Date;

  /** Órdenes del cliente anonimizadas, con sus envíos. @example 3 */
  anonymizedOrderCount: number;
}

/**
 * Request of `POST /v1/admin/identity/guest-anonymizations` (API_SPEC.md §9.18): the guest is found as in the lookup
 * of their order (ADR-0138).
 */
export class AnonymizeGuestDto extends AnonymizationReasonDto {
  /**
   * Email de contacto de las órdenes, sin distinguir mayúsculas y minúsculas.
   * @example 'cliente@example.com'
   */
  @Transform(toNormalizedEmail)
  @IsEmail()
  @MaxLength(254)
  contactEmail: string;

  /**
   * Código público de una de sus órdenes, con o sin guion y sin distinguir mayúsculas y minúsculas.
   * @example 'K7M4-Q9XA'
   */
  @IsString()
  @Length(1, 100)
  @Matches(/\S/, NOT_BLANK)
  publicCode: string;
}

/** Response of `POST /v1/admin/identity/guest-anonymizations` (API_SPEC.md §9.18). */
export class GuestAnonymizationDto {
  /** Órdenes de invitado con ese email anonimizadas, con sus envíos. @example 3 */
  anonymizedOrderCount: number;
}
