import { passwordShapeProblem } from './password.js';
import {
  newTemporaryPassword,
  TEMPORARY_PASSWORD_ALPHABET,
} from './temporary-password.js';

describe('newTemporaryPassword (BR-USR-13, ADR-0116)', () => {
  it('has five groups of four characters of the alphabet, joined by hyphens', () => {
    expect(newTemporaryPassword()).toMatch(
      /^[a-km-np-z2-9]{4}(-[a-km-np-z2-9]{4}){4}$/,
    );
  });

  it('uses 32 characters, none of the ones people confuse', () => {
    expect(TEMPORARY_PASSWORD_ALPHABET).toHaveLength(32);
    expect(new Set(TEMPORARY_PASSWORD_ALPHABET).size).toBe(32);
    for (const confusing of ['0', 'o', '1', 'l']) {
      expect(TEMPORARY_PASSWORD_ALPHABET).not.toContain(confusing);
    }
  });

  it('fits the password policy', () => {
    expect(passwordShapeProblem(newTemporaryPassword())).toBeNull();
  });

  it('draws every character of the alphabet and never repeats a password', () => {
    const passwords = Array.from({ length: 500 }, newTemporaryPassword);

    expect(new Set(passwords).size).toBe(500);
    const used = new Set(passwords.join('').replaceAll('-', ''));
    expect([...used].sort().join('')).toBe(
      [...TEMPORARY_PASSWORD_ALPHABET].sort().join(''),
    );
  });
});
