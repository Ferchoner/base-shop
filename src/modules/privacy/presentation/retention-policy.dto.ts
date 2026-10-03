import { ApiProperty } from '@nestjs/swagger';

// Plain string, number and boolean fields are documented by the Swagger plugin from their types and comments; nested
// DTOs and null declare their type with @ApiProperty (DEVELOPMENT_GUIDE.md).

/** The retention cycle of the personal data of orders and shipments (ADR-0070, ADR-0149). */
export class PersonalDataRetentionDto {
  /** Si el ciclo está activo; si no, los datos se conservan. */
  enabled: boolean;

  /**
   * Meses que los datos personales de un pedido siguen visibles después de que concluye; después se bloquean.
   * @example 12
   */
  operationalMonths: number;

  /**
   * Meses que siguen bloqueados antes de anonimizarse; con 0, se anonimizan al terminar la fase operativa.
   * @example 60
   */
  blockedMonths: number;
}

/** The technical audit trail, which records IPs and user agents (ADR-0037, ADR-0146). */
export class AuditTrailRetentionDto {
  /** @example 3 */
  databaseMonths: number;

  /** @example 24 */
  archiveMonths: number;
}

/** Response of `GET /v1/privacy/retention-policy` (ADR-0149, ADR-0152). */
export class RetentionPolicyDto {
  @ApiProperty({ type: () => PersonalDataRetentionDto })
  personalData: PersonalDataRetentionDto;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: null,
    description:
      'Meses sin actividad (registrarse, iniciar sesión o renovarla) tras los que se anonimiza la cuenta de un cliente; `null` si nunca se anonimiza por inactividad.',
  })
  inactiveCustomerMonths: number | null;

  @ApiProperty({ type: () => AuditTrailRetentionDto })
  auditTrail: AuditTrailRetentionDto;

  /**
   * Días que se conserva un refresh token vencido o revocado.
   * @example 30
   */
  spentRefreshTokenDays: number;

  /**
   * Días que se conserva un carrito de invitado sin actividad.
   * @example 30
   */
  inactiveGuestCartDays: number;

  /**
   * Días que se conserva un evento de webhook de pagos procesado.
   * @example 30
   */
  processedWebhookEventDays: number;
}
