import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CommonPasswords } from '../application/password-policy.js';
import { commonPasswordEntries } from '../domain/password.js';

/**
 * The list, relative to the working directory: the repository root, or `/app` in the production image, which
 * copies `data/passwords/` (ADR-0115).
 */
export const COMMON_PASSWORDS_FILE = 'data/passwords/common-passwords.txt';

/**
 * The common password list of `data/passwords/`, loaded into memory at startup (ADR-0047, ADR-0115). Without
 * it the API does not start: the policy would silently stop rejecting common passwords. The module builds it
 * with a factory, since its constructor takes the file.
 */
export class FileCommonPasswords extends CommonPasswords {
  private readonly keys: ReadonlySet<string>;

  constructor(file: string = COMMON_PASSWORDS_FILE) {
    super();
    const path = resolve(file);
    let text: string;
    try {
      text = readFileSync(path, 'utf8');
    } catch (error) {
      throw new Error(
        `The common password list could not be read at ${path} (ADR-0115)`,
        { cause: error },
      );
    }
    // Normalized again here, so the list always matches the policy's own lookup keys.
    this.keys = new Set(commonPasswordEntries(text.split('\n')));
    if (this.keys.size === 0) {
      throw new Error(
        `The common password list at ${path} is empty (ADR-0115)`,
      );
    }
  }

  includes(key: string): boolean {
    return this.keys.has(key);
  }
}
