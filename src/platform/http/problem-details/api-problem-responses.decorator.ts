import { applyDecorators } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import { ProblemDetailsSchema } from './problem-details.schema.js';
import { PROBLEM_TYPES, type ProblemCode } from './problem-types.js';

/** Errors every endpoint can answer (`API_SPEC.md` §6.3). */
const COMMON_PROBLEMS: readonly ProblemCode[] = [
  'validation-error',
  'rate-limit-exceeded',
  'internal-error',
];

/**
 * Documents the error responses of an endpoint in OpenAPI (ADR-0096): the given problem types plus the
 * common ones, grouped by HTTP status, all with the Problem Details schema.
 *
 * ```ts
 * @ApiProblemResponses('not-found', 'version-conflict')
 * ```
 */
export function ApiProblemResponses(
  ...codes: ProblemCode[]
): MethodDecorator & ClassDecorator {
  const byStatus = new Map<number, ProblemCode[]>();
  for (const code of new Set([...codes, ...COMMON_PROBLEMS])) {
    const { status } = PROBLEM_TYPES[code];
    byStatus.set(status, [...(byStatus.get(status) ?? []), code]);
  }
  return applyDecorators(
    ApiExtraModels(ProblemDetailsSchema),
    ...[...byStatus.entries()].map(([status, statusCodes]) =>
      ApiResponse({
        status,
        description: statusCodes
          .map((code) => `\`${code}\`: ${PROBLEM_TYPES[code].title}`)
          .join('; '),
        content: {
          'application/problem+json': {
            schema: { $ref: getSchemaPath(ProblemDetailsSchema) },
          },
        },
      }),
    ),
  );
}
