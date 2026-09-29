import {
  commonPasswordEntries,
  commonPasswordKey,
  normalizePassword,
  PasswordPolicyViolationError,
  passwordShapeProblem,
} from './password.js';

describe('password policy rules (ADR-0047, ADR-0115)', () => {
  describe('length', () => {
    it.each([
      ['15 characters', 'a'.repeat(15)],
      ['64 characters', 'a'.repeat(64)],
      ['a passphrase', 'una frase larga y segura'],
    ])('accepts %s', (_, password) => {
      expect(passwordShapeProblem(password)).toBeNull();
    });

    it.each([
      ['14 characters', 'a'.repeat(14)],
      ['65 characters', 'a'.repeat(65)],
      ['an empty password', ''],
    ])('rejects %s', (_, password) => {
      expect(passwordShapeProblem(password)).toBe('passwordLength');
    });

    it('counts characters of the normalized password, however they were typed', () => {
      const composed = 'ñandú'.repeat(3);
      const decomposed = composed.normalize('NFD');

      expect(composed.length).toBe(15);
      expect(decomposed.length).toBe(21);
      expect(passwordShapeProblem(decomposed)).toBeNull();
      // An emoji is one character, although JavaScript strings count it as two.
      expect(passwordShapeProblem(`${'a'.repeat(13)}😀`)).toBe(
        'passwordLength',
      );
      expect(passwordShapeProblem(`${'a'.repeat(14)}😀`)).toBeNull();
    });
  });

  describe('characters', () => {
    it.each([
      ['accented letters and ñ', 'Árbol, canción y ñandú'],
      [
        'every printable symbol ADR-0047 names',
        '.,!?_-@#$%&*+=/\\()[]{}:;"\'<>~^|`',
      ],
      ['other alphabets', 'пароль для входа в систему'],
      ['letters without spaces', '暗号化されたパスワードですよね'],
      ['an emoji with a skin tone', 'mi contraseña 👍🏽 larga'],
      ['a no-break space, normalized to a space', 'una frase larga y segura'],
    ])('accepts %s', (_, password) => {
      expect(passwordShapeProblem(password)).toBeNull();
    });

    it.each([
      ['a tab', 'una frase\tlarga y segura'],
      ['a line break', 'una frase\nlarga y segura'],
      ['a control character', 'una frase larga y segura\u0007'],
      ['a zero-width space', 'una frase​larga y segura'],
      ['an emoji joined with an invisible joiner', 'una frase larga 👩‍💻'],
    ])('rejects %s', (_, password) => {
      expect(passwordShapeProblem(password)).toBe('passwordCharacters');
    });
  });

  it('normalizes to NFKC, as the hash does', () => {
    expect(normalizePassword('ｃｏｎｔｒａｓｅñａ')).toBe('contraseña');
  });

  it('looks up common passwords normalized and in lowercase', () => {
    expect(commonPasswordKey('１Ｑ２Ｗ3E4R5T6Y7U8I')).toBe('1q2w3e4r5t6y7u8i');
  });

  describe('commonPasswordEntries', () => {
    it('keeps only what the policy would otherwise accept, as lookup keys, once and in order', () => {
      expect(
        commonPasswordEntries([
          '123456',
          'QwertyuiopAsdfgh\r',
          'contraseña segura 2024',
          'qwertyuiopasdfgh',
          'x'.repeat(65),
          'una\tfrase larga y segura',
          '',
        ]),
      ).toEqual(['qwertyuiopasdfgh', 'contraseña segura 2024']);
    });
  });

  it('answers a violation as the error of its field, with a Spanish message', () => {
    const error = new PasswordPolicyViolationError(
      'commonPassword',
      'newPassword',
    );

    expect(error).toMatchObject({
      code: 'password-policy-violation',
      category: 'invalid',
      problem: 'commonPassword',
      details: {
        errors: [
          {
            field: 'newPassword',
            code: 'commonPassword',
            message: 'Es una contraseña común; elige otra.',
          },
        ],
      },
    });
  });

  it.each([
    ['passwordLength', 'Debe tener entre 15 y 64 caracteres.'],
    [
      'passwordCharacters',
      'Solo puede tener letras, dígitos, espacios y signos o símbolos imprimibles.',
    ],
    ['samePassword', 'Debe ser distinta de la contraseña actual.'],
  ] as const)('explains %s', (problem, message) => {
    expect(
      new PasswordPolicyViolationError(problem, 'password').details,
    ).toEqual({ errors: [{ field: 'password', code: problem, message }] });
  });
});
