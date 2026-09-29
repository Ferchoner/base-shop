import { DomainError } from '../../../shared-kernel/index.js';

/** Length limits of every password, temporary ones included (ADR-0047, BR-USR-10). */
export const PASSWORD_MIN_LENGTH = 15;
export const PASSWORD_MAX_LENGTH = 64;

/**
 * Letters of any alphabet with their accents, digits, punctuation, symbols (emoji included) and the space
 * (ADR-0047, ADR-0115). Tabs, line breaks, and control or invisible characters are not.
 */
const ALLOWED_CHARACTERS = /^[\p{L}\p{M}\p{N}\p{P}\p{S} ]*$/u;

/** Why a password breaks the policy; each one is the `code` of its field error. */
export type PasswordProblem =
  'passwordLength' | 'passwordCharacters' | 'commonPassword' | 'samePassword';

const MESSAGES: Record<PasswordProblem, string> = {
  passwordLength: `Debe tener entre ${PASSWORD_MIN_LENGTH} y ${PASSWORD_MAX_LENGTH} caracteres.`,
  passwordCharacters:
    'Solo puede tener letras, dígitos, espacios y signos o símbolos imprimibles.',
  commonPassword: 'Es una contraseña común; elige otra.',
  samePassword: 'Debe ser distinta de la contraseña actual.',
};

/**
 * The form in which a password is measured, compared and hashed: Unicode NFKC, as NIST SP 800-63B
 * recommends, so the same password typed on different keyboards is the same password.
 */
export function normalizePassword(password: string): string {
  return password.normalize('NFKC');
}

/**
 * Length and characters of a password; `null` when both fit the policy. The length counts characters (code
 * points) of the normalized password, so an accented letter is one character however it was typed.
 */
export function passwordShapeProblem(
  password: string,
): 'passwordLength' | 'passwordCharacters' | null {
  const normalized = normalizePassword(password);
  const length = [...normalized].length;
  if (length < PASSWORD_MIN_LENGTH || length > PASSWORD_MAX_LENGTH) {
    return 'passwordLength';
  }
  return ALLOWED_CHARACTERS.test(normalized) ? null : 'passwordCharacters';
}

/** How a password is looked up in the common password list: normalized and in lowercase (ADR-0047). */
export function commonPasswordKey(password: string): string {
  return normalizePassword(password).toLowerCase();
}

/**
 * The entries of a common password list that matter to the policy, as lookup keys and without repeats, in
 * their original order: those the length and character rules would otherwise accept.
 */
export function commonPasswordEntries(lines: Iterable<string>): string[] {
  const entries = new Set<string>();
  for (const line of lines) {
    const entry = line.replace(/\r$/, '');
    if (passwordShapeProblem(entry) === null) {
      entries.add(commonPasswordKey(entry));
    }
  }
  return [...entries];
}

/**
 * A new password breaks the policy (ADR-0047, BR-USR-10, E-21): 400 `password-policy-violation`, with the
 * rule that failed as the error of its field.
 */
export class PasswordPolicyViolationError extends DomainError {
  readonly code = 'password-policy-violation';
  readonly category = 'invalid';

  constructor(
    readonly problem: PasswordProblem,
    field: string,
  ) {
    super(`The password breaks the policy: ${problem}`, {
      errors: [{ field, code: problem, message: MESSAGES[problem] }],
    });
  }
}
