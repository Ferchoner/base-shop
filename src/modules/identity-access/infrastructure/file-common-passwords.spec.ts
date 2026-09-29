import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  COMMON_PASSWORDS_FILE,
  FileCommonPasswords,
} from './file-common-passwords.js';

describe('FileCommonPasswords (ADR-0047, ADR-0115)', () => {
  let directory: string;

  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'common-passwords-'));
  });

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('loads the list versioned in data/passwords', () => {
    const list = new FileCommonPasswords();

    expect(COMMON_PASSWORDS_FILE).toBe('data/passwords/common-passwords.txt');
    expect(list.includes('1q2w3e4r5t6y7u8i')).toBe(true);
    expect(list.includes('123456789123456789')).toBe(true);
    expect(list.includes('una frase larga y segura')).toBe(false);
  });

  it('turns every entry into a lookup key, so the file cannot drift from the policy', () => {
    const file = join(directory, 'list.txt');
    writeFileSync(file, 'QwertyuiopAsdfgh\r\n123456\r\n');

    const list = new FileCommonPasswords(file);

    expect(list.includes('qwertyuiopasdfgh')).toBe(true);
    expect(list.includes('123456')).toBe(false);
  });

  it('keeps the API from starting without the list', () => {
    const missing = join(directory, 'missing.txt');

    expect(() => new FileCommonPasswords(missing)).toThrow(
      `The common password list could not be read at ${missing}`,
    );
  });

  it('keeps the API from starting with an empty list', () => {
    const file = join(directory, 'empty.txt');
    writeFileSync(file, '123456\n\n');

    expect(() => new FileCommonPasswords(file)).toThrow(
      `The common password list at ${file} is empty`,
    );
  });
});
