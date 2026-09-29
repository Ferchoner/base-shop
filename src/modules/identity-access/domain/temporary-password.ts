import { randomInt } from 'node:crypto';

/**
 * Lowercase letters and digits without the ones people confuse: `0` and `o`, `1` and `l` (ADR-0116). 32
 * symbols, so each one carries 5 bits.
 */
const LETTERS = 'abcdefghijkmnpqrstuvwxyz';
const DIGITS = '23456789';
export const TEMPORARY_PASSWORD_ALPHABET = LETTERS + DIGITS;

const GROUPS = 5;
const GROUP_LENGTH = 4;

/**
 * A new temporary password for a staff member (BR-USR-13, ADR-0047, ADR-0116): 20 random characters in five
 * groups of four joined by hyphens, such as `k7qm-3xrt-9fzw-p4hd-2nvc`. 24 characters and about 100 bits,
 * easy to read out or copy, and within the password policy.
 */
export function newTemporaryPassword(): string {
  return Array.from({ length: GROUPS }, () =>
    Array.from(
      { length: GROUP_LENGTH },
      () =>
        TEMPORARY_PASSWORD_ALPHABET[
          randomInt(TEMPORARY_PASSWORD_ALPHABET.length)
        ],
    ).join(''),
  ).join('-');
}
