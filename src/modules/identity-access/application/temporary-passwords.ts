import { Injectable } from '@nestjs/common';
import { newTemporaryPassword } from '../domain/temporary-password.js';
import { PasswordHasher } from './password-hasher.js';
import { PasswordPolicy } from './password-policy.js';

/**
 * Issues temporary passwords for staff (BR-USR-13, ADR-0116): generated, checked against the same policy as
 * any other password (ADR-0047), and hashed. The plain password only goes back to whoever shows it once.
 */
@Injectable()
export class TemporaryPasswords {
  constructor(
    private readonly policy: PasswordPolicy,
    private readonly hasher: PasswordHasher,
  ) {}

  async issue(): Promise<{ password: string; hash: string }> {
    const password = newTemporaryPassword();
    this.policy.assertAcceptable(password, 'temporaryPassword');
    return { password, hash: await this.hasher.hash(password) };
  }
}
