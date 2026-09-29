import { Injectable } from '@nestjs/common';
import {
  commonPasswordKey,
  PasswordPolicyViolationError,
  passwordShapeProblem,
} from '../domain/password.js';

/**
 * The common password list (ADR-0047): a local list, never an external service. An abstract class rather
 * than an interface, so it can be the dependency injection token without depending on NestJS.
 */
export abstract class CommonPasswords {
  /** Whether the list has this key, as `commonPasswordKey` builds it. */
  abstract includes(key: string): boolean;
}

/**
 * The password policy of every account (ADR-0047, BR-USR-10): 15 to 64 characters, no composition rules,
 * printable characters only, and not a common password. For new passwords: changes, sign-ups, resets and
 * temporary passwords.
 */
@Injectable()
export class PasswordPolicy {
  constructor(private readonly common: CommonPasswords) {}

  /** @throws PasswordPolicyViolationError naming `field` when the password breaks the policy. */
  assertAcceptable(password: string, field: string): void {
    const shape = passwordShapeProblem(password);
    if (shape !== null) throw new PasswordPolicyViolationError(shape, field);
    if (this.common.includes(commonPasswordKey(password))) {
      throw new PasswordPolicyViolationError('commonPassword', field);
    }
  }
}
