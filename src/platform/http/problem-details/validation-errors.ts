import { ValidationPipe, type ValidationError } from '@nestjs/common';
import { ProblemException } from './problem.exception.js';

/** One entry of the `errors` extension of a `validation-error` problem (`API_SPEC.md` §6.1). */
export interface FieldError {
  /** Path of the field, such as `shippingAddress.phone` or `lines[2].quantity`. */
  readonly field: string;
  /** Name of the failed class-validator constraint, such as `isInt` or `matches`. */
  readonly code: string;
  readonly message: string;
}

/**
 * Spanish message for each class-validator constraint (ADR-0071, ADR-0095). class-validator writes its own
 * messages in English, so they are never shown. A DTO gives a more specific message for one field with
 * `{ context: { message: 'Debe tener 5 dígitos.' } }` in the decorator options.
 */
const MESSAGES: Readonly<Record<string, string>> = {
  whitelistValidation: 'No es un campo permitido.',
  unknownValue: 'El contenido de la solicitud no es válido.',
  isDefined: 'Es obligatorio.',
  isNotEmpty: 'Es obligatorio.',
  isString: 'Debe ser texto.',
  isBoolean: 'Debe ser verdadero o falso.',
  isInt: 'Debe ser un número entero.',
  isNumber: 'Debe ser un número.',
  isPositive: 'Debe ser mayor que cero.',
  min: 'Es menor que el mínimo permitido.',
  max: 'Es mayor que el máximo permitido.',
  minLength: 'Es más corto de lo permitido.',
  maxLength: 'Es más largo de lo permitido.',
  isLength: 'No tiene una longitud permitida.',
  matches: 'No tiene el formato esperado.',
  isUuid: 'Debe ser un identificador válido.',
  isEmail: 'Debe ser un correo electrónico válido.',
  isUrl: 'Debe ser una dirección web válida.',
  isEnum: 'No es uno de los valores permitidos.',
  isIn: 'No es uno de los valores permitidos.',
  isDateString: 'Debe ser una fecha válida.',
  isIso8601: 'Debe ser una fecha válida.',
  isArray: 'Debe ser una lista.',
  arrayNotEmpty: 'Debe tener al menos un elemento.',
  arrayMinSize: 'Tiene menos elementos de los permitidos.',
  arrayMaxSize: 'Tiene más elementos de los permitidos.',
  arrayUnique: 'No puede tener elementos repetidos.',
  isObject: 'Debe ser un objeto.',
  nestedValidation: 'Debe ser un objeto válido.',
};

const FALLBACK_MESSAGE = 'El valor no es válido.';

/**
 * Constraints reported before the others when several fail on one field (ADR-0130): whether the field is present,
 * then whether its value has the right type. A value of the wrong type also fails the length and range
 * constraints, and their messages would mislead, such as "Es mayor que el máximo permitido." for `abc`. An
 * undeclared field fails only `whitelistValidation`.
 */
const BASIC_CONSTRAINTS = [
  'isDefined',
  'isNotEmpty',
  'isString',
  'isInt',
  'isNumber',
  'isBoolean',
  'isArray',
  'isObject',
];

/**
 * The one constraint reported for a field: the first basic one that failed, or else the first that failed, in
 * the order class-validator ran them.
 */
function reportedConstraint(failed: readonly string[]): string | undefined {
  return BASIC_CONSTRAINTS.find((code) => failed.includes(code)) ?? failed[0];
}

/** Flattens class-validator errors into the `errors` extension, one entry per field. */
export function toFieldErrors(
  errors: readonly ValidationError[],
  parentPath = '',
): FieldError[] {
  return errors.flatMap((error) => {
    const field = joinPath(parentPath, error.property);
    const code = reportedConstraint(Object.keys(error.constraints ?? {}));
    const own =
      code === undefined
        ? []
        : [{ field, code, message: messageFor(error, code) }];
    return [...own, ...toFieldErrors(error.children ?? [], field)];
  });
}

/**
 * Input validation for every endpoint (ADR-0087, ADR-0095). Undeclared fields and query parameters are
 * rejected (`API_SPEC.md` §5.3). Every constraint of a field runs, whatever the order of its decorators, and one
 * is reported per field: presence and type first (ADR-0130). Custom constraints must accept a value of any type.
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    // Rejected values stay out of the error objects, so they cannot reach a response or a log.
    validationError: { target: false, value: false },
    exceptionFactory: (errors) =>
      new ProblemException('validation-error', {
        errors: toFieldErrors(errors),
      }),
  });
}

function joinPath(parentPath: string, property: string): string {
  if (/^\d+$/.test(property)) return `${parentPath}[${property}]`;
  return parentPath ? `${parentPath}.${property}` : property;
}

function messageFor(error: ValidationError, code: string): string {
  const context: unknown = error.contexts?.[code];
  if (
    typeof context === 'object' &&
    context !== null &&
    'message' in context &&
    typeof context.message === 'string'
  ) {
    return context.message;
  }
  return MESSAGES[code] ?? FALLBACK_MESSAGE;
}
