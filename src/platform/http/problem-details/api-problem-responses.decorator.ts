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

/** The problem types already documented on a handler or a controller. */
const DOCUMENTED_PROBLEMS = Symbol('documented-problems');

/**
 * Documents the error responses of an endpoint in OpenAPI (ADR-0096): the given problem types plus the
 * common ones, grouped by HTTP status, all with the Problem Details schema. On a controller, they apply to
 * every handler, together with the handler's own (ADR-0155): Swagger lets a handler's response replace the
 * controller's of the same status, so a handler with its own 401 would lose `unauthenticated`. Declared more
 * than once on the same target, the types add up, each listed once.
 *
 * ```ts
 * @ApiProblemResponses('not-found', 'version-conflict')
 * ```
 */
export function ApiProblemResponses(
  ...codes: ProblemCode[]
): MethodDecorator & ClassDecorator {
  return ((
    target: object,
    key?: string | symbol,
    descriptor?: PropertyDescriptor,
  ) => {
    if (descriptor !== undefined) {
      document(
        descriptor.value as object,
        [...codes, ...COMMON_PROBLEMS],
        (decorator) => decorator(target, key as string, descriptor),
      );
      return;
    }
    const controller = target as { prototype: Record<string, unknown> };
    document(controller, [...codes, ...COMMON_PROBLEMS], (decorator) =>
      decorator(controller as never),
    );
    // Class decorators run after those of the handlers, so the handlers with their own types have them already.
    const shared = documentedOn(controller) ?? [];
    for (const name of Object.getOwnPropertyNames(controller.prototype)) {
      const handler = Object.getOwnPropertyDescriptor(
        controller.prototype,
        name,
      );
      const value = handler?.value as object | undefined;
      if (name === 'constructor' || !handler || !value) continue;
      if (documentedOn(value) === undefined) continue;
      document(value, shared, (decorator) =>
        decorator(controller.prototype, name, handler),
      );
    }
  }) as MethodDecorator & ClassDecorator;
}

/**
 * Writes on `target` the responses of the types it does not document yet, and remembers them. Swagger joins the
 * descriptions of the responses written twice for the same status, so no type is ever written twice.
 */
function document(
  target: object,
  codes: readonly ProblemCode[],
  write: (decorator: MethodDecorator & ClassDecorator) => void,
): void {
  const documented = documentedOn(target) ?? [];
  const missing = [...new Set(codes)].filter(
    (code) => !documented.includes(code),
  );
  if (missing.length === 0) return;
  Reflect.defineMetadata(
    DOCUMENTED_PROBLEMS,
    [...documented, ...missing],
    target,
  );
  write(responses(missing));
}

function documentedOn(target: object): ProblemCode[] | undefined {
  return Reflect.getOwnMetadata(DOCUMENTED_PROBLEMS, target) as
    ProblemCode[] | undefined;
}

/** One response per status of `codes`, each listing its types. */
function responses(
  codes: readonly ProblemCode[],
): MethodDecorator & ClassDecorator {
  const byStatus = new Map<number, ProblemCode[]>();
  for (const code of codes) {
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
