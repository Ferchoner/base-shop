import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ChangeEmailDto, ChangePasswordDto } from './account.dto.js';
import { LoginDto, PASSWORD_INPUT_MAX_LENGTH } from './auth.dto.js';

/** The fields of each request that carry a password to compare, with the rest valid. */
const REQUESTS = [
  [LoginDto, 'password', { email: 'ana@example.com' }],
  [
    ChangePasswordDto,
    'currentPassword',
    { newPassword: 'una frase nueva y larga' },
  ],
  [ChangeEmailDto, 'currentPassword', { newEmail: 'ana@example.com' }],
] as const;

const errorsOf = (
  type: (typeof REQUESTS)[number][0],
  body: Record<string, unknown>,
) =>
  validateSync(plainToInstance(type as new () => object, body)).map(
    ({ property }) => property,
  );

describe('Passwords to compare (T-310, ADR-0115)', () => {
  it.each(REQUESTS)(
    '%p accepts up to 256 characters as typed, as a password in a decomposed form takes',
    (type, field, rest) => {
      expect(PASSWORD_INPUT_MAX_LENGTH).toBe(256);
      // 128 accented letters typed as NFD: 256 characters, 128 after NFKC.
      expect(
        errorsOf(type, { ...rest, [field]: 'e\u0301'.repeat(128) }),
      ).toEqual([]);
      expect(errorsOf(type, { ...rest, [field]: 'x'.repeat(257) })).toEqual([
        field,
      ]);
    },
  );
});
