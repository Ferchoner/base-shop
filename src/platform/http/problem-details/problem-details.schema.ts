import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { PROBLEM_TYPES, problemTypeUri } from './problem-types.js';

/** OpenAPI schema of one entry of `errors` (`API_SPEC.md` §6.1). */
@ApiSchema({ name: 'FieldError' })
export class FieldErrorSchema {
  @ApiProperty({
    description: 'Ruta del campo, como `lines[2].quantity`.',
    example: 'postalCode',
  })
  field: string;

  @ApiProperty({
    description: 'Regla de validación que falló.',
    example: 'matches',
  })
  code: string;

  @ApiProperty({
    description: 'Mensaje en español.',
    example: 'Debe tener 5 dígitos.',
  })
  message: string;
}

/**
 * OpenAPI schema of every error response (RFC 9457, ADR-0035, ADR-0096). Only documentation: the filter of
 * ADR-0095 builds the actual responses.
 */
@ApiSchema({ name: 'ProblemDetails' })
export class ProblemDetailsSchema {
  @ApiProperty({
    description:
      'Tipo de error estable; los clientes deciden por este campo (`API_SPEC.md`, sección 6.2).',
    enum: Object.keys(PROBLEM_TYPES).map(problemTypeUri),
    example: '/problems/not-found',
  })
  type: string;

  @ApiProperty({
    description: 'Resumen fijo por tipo, en español.',
    example: 'No encontrado',
  })
  title: string;

  @ApiProperty({ description: 'Código de estado HTTP.', example: 404 })
  status: number;

  @ApiProperty({
    description: 'Explicación fija por tipo, en español.',
    example: 'El recurso solicitado no existe.',
  })
  detail: string;

  @ApiProperty({
    description: 'Ruta de la solicitud, sin la cadena de consulta.',
    example: '/v1/catalog/products/playera-basica',
  })
  instance: string;

  @ApiProperty({
    description:
      'Identificador de la solicitud; el mismo que el encabezado `X-Correlation-Id`.',
    format: 'uuid',
  })
  correlationId: string;

  @ApiPropertyOptional({
    description:
      'Solo en `validation-error`: campos inválidos. Otros tipos agregan sus propias extensiones, como `lines` o `currentVersion` (`API_SPEC.md`, sección 6.2).',
    type: [FieldErrorSchema],
  })
  errors?: FieldErrorSchema[];
}
