import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';
import {
  CursorMetaDto,
  CursorQueryDto,
} from '../../../platform/http/pagination/cursor.js';
import { CommaSeparated } from '../../../platform/http/pagination/pagination.js';
import type { AuditActor, AuditResult } from '../../../shared-kernel/index.js';
import { ACTOR_TYPES, AUDIT_RESULTS } from '../application/audit-entries.js';

// Plain string, number and boolean fields are documented by the Swagger plugin from their types and comments;
// fields holding other DTOs, lists, dates, enums, objects or null declare their type with @ApiProperty
// (DEVELOPMENT_GUIDE.md).

const NULLABLE_TEXT = { type: String, nullable: true } as const;
const NOT_BLANK = { context: { message: 'No puede estar vacío.' } };

/** An action code, such as `orders.cancel`, or the prefix of one followed by `.*`, such as `orders.*`. */
export const ACTION_FILTER = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*(\.\*)?$/;

/** Query of `GET /v1/admin/audit` (UC-AUD-02, API_SPEC.md §18). */
export class AuditQueryDto extends CursorQueryDto {
  /** Solo las acciones de este usuario. */
  @IsOptional()
  @IsUUID()
  actorId?: string;

  @ApiPropertyOptional({
    type: String,
    description:
      'Uno o más, separados por comas: `USER`, `SYSTEM`, `ANONYMOUS`.',
    example: 'USER',
  })
  @IsOptional()
  @CommaSeparated()
  @IsIn(ACTOR_TYPES, { each: true })
  actorType?: AuditActor['type'][];

  /**
   * Código exacto, como `orders.cancel`, o prefijo terminado en `.*`, como `orders.*`.
   * @example 'orders.*'
   */
  @IsOptional()
  @Matches(ACTION_FILTER, {
    context: {
      message:
        'Debe ser un código como orders.cancel o un prefijo como orders.*.',
    },
  })
  action?: string;

  /**
   * Solo las acciones sobre recursos de este tipo.
   * @example 'order'
   */
  @IsOptional()
  @IsString()
  @Length(1, 100)
  @Matches(/\S/, NOT_BLANK)
  resourceType?: string;

  /** Solo las de este recurso, por su ID exacto; con `resourceType`, de ese tipo. */
  @IsOptional()
  @IsString()
  @Length(1, 200)
  @Matches(/\S/, NOT_BLANK)
  resourceId?: string;

  @ApiPropertyOptional({
    type: String,
    description:
      'Uno o más, separados por comas: `SUCCESS`, `DENIED`, `FAILED`.',
    example: 'DENIED',
  })
  @IsOptional()
  @CommaSeparated()
  @IsIn(AUDIT_RESULTS, { each: true })
  result?: AuditResult[];

  /** Fecha o fecha y hora ISO 8601; incluida. @example '2026-10-01' */
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  /** Fecha o fecha y hora ISO 8601; incluida (una fecha sola incluye todo el día). @example '2026-10-31' */
  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}

/** `AuditEntry` of API_SPEC.md §18 (ADR-0037, ADR-0100). */
export class AuditEntryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: String, format: 'date-time' })
  occurredAt: Date;

  /** Quién actuó: `USER` con sesión, `SYSTEM` en jobs y eventos, o `ANONYMOUS` sin sesión. */
  @ApiProperty({ enum: ACTOR_TYPES })
  actorType: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'El usuario, cuando `actorType` es USER.',
  })
  actorId: string | null;

  /**
   * Código de la acción, como `orders.cancel`.
   * @example 'orders.cancel'
   */
  action: string;

  /** Tipo del recurso; `null` si la acción no tiene uno. */
  @ApiProperty({ ...NULLABLE_TEXT, example: 'order' })
  resourceType: string | null;

  /** ID del recurso; `null` si la acción no tiene uno. */
  @ApiProperty(NULLABLE_TEXT)
  resourceId: string | null;

  /** `SUCCESS`, `DENIED` o `FAILED`. */
  @ApiProperty({ enum: AUDIT_RESULTS })
  result: string;

  /** El identificador de la solicitud (`X-Correlation-Id`) o del job; `null` si no hubo. */
  @ApiProperty(NULLABLE_TEXT)
  correlationId: string | null;

  /** IP de la solicitud; `null` fuera de una. */
  @ApiProperty({ ...NULLABLE_TEXT, example: '203.0.113.7' })
  ip: string | null;

  /** Navegador o cliente de la solicitud; `null` fuera de una. */
  @ApiProperty(NULLABLE_TEXT)
  userAgent: string | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description:
      'Solo los campos que cambiaron: `{ "from", "to" }`, o `{ "changed": true }` si son personales o sensibles (ADR-0067).',
    example: { status: { from: 'PAID', to: 'CANCELLED' } },
  })
  changes: Record<string, unknown> | null;

  @ApiProperty({
    ...NULLABLE_TEXT,
    description:
      'El motivo que dio el staff, cuando la acción lo pide (ADR-0112).',
  })
  reason: string | null;
}

export class AuditEntryListDto {
  @ApiProperty({
    type: () => [AuditEntryDto],
    description: 'Del más reciente al más antiguo.',
  })
  data: AuditEntryDto[];

  @ApiProperty({ type: () => CursorMetaDto })
  meta: CursorMetaDto;
}
