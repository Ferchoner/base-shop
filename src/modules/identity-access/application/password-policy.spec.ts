import { PasswordPolicyViolationError } from '../domain/password.js';
import { CommonPasswords, PasswordPolicy } from './password-policy.js';

class ListedPasswords extends CommonPasswords {
  constructor(private readonly keys: string[]) {
    super();
  }

  includes(key: string): boolean {
    return this.keys.includes(key);
  }
}

describe('PasswordPolicy (ADR-0047, BR-USR-10)', () => {
  const policy = new PasswordPolicy(new ListedPasswords(['1q2w3e4r5t6y7u8i']));

  function problemOf(password: string, field = 'newPassword') {
    try {
      policy.assertAcceptable(password, field);
      return null;
    } catch (error) {
      expect(error).toBeInstanceOf(PasswordPolicyViolationError);
      return (error as PasswordPolicyViolationError).details;
    }
  }

  it('accepts a long password that is not common', () => {
    expect(problemOf('una frase larga y segura')).toBeNull();
  });

  it.each([
    '1q2w3e4r5t6y7u8i',
    '1Q2W3E4R5T6Y7U8I',
    '１ｑ２ｗ３ｅ４ｒ５ｔ６ｙ７ｕ８ｉ',
  ])(
    'rejects the common password %p, whatever its case or width',
    (password) => {
      expect(problemOf(password)).toEqual({
        errors: [expect.objectContaining({ code: 'commonPassword' })],
      });
    },
  );

  it('checks length and characters before the list, on the given field', () => {
    expect(problemOf('corta', 'password')).toEqual({
      errors: [
        expect.objectContaining({ field: 'password', code: 'passwordLength' }),
      ],
    });
    expect(problemOf('1q2w3e4r5t6y7u8i\t')).toEqual({
      errors: [expect.objectContaining({ code: 'passwordCharacters' })],
    });
  });
});
