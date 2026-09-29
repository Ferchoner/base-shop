import { Argon2PasswordHasher } from './argon2-password-hasher.js';

const PASSWORD = 'una frase larga y segura';

describe('Argon2PasswordHasher (ADR-0023, ADR-0114)', () => {
  const hasher = new Argon2PasswordHasher();

  it('hashes with Argon2id and the OWASP cost, in PHC format', async () => {
    const hash = await hasher.hash(PASSWORD);

    expect(hash).toMatch(
      /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/,
    );
    expect(hash).not.toContain(PASSWORD);
  });

  it('uses a new salt for every hash', async () => {
    expect(await hasher.hash(PASSWORD)).not.toBe(await hasher.hash(PASSWORD));
  });

  it('verifies the right password and rejects any other', async () => {
    const hash = await hasher.hash(PASSWORD);

    await expect(hasher.verify(PASSWORD, hash)).resolves.toBe(true);
    await expect(hasher.verify(`${PASSWORD} `, hash)).resolves.toBe(false);
    await expect(hasher.verify('Una frase larga y segura', hash)).resolves.toBe(
      false,
    );
  });

  it('verifies hashes of other Argon2id implementations, with their own cost', async () => {
    // The example of the argon2-cffi documentation: 64 MiB, 3 passes, 4 lanes.
    const hash =
      '$argon2id$v=19$m=65536,t=3,p=4$MIIRqgvgQbgj220jfp0MPA$YfwJSVjtjSU0zzV/P3S9nnQ/USre2wvJMjfCIjrTQbg';

    await expect(
      hasher.verify('correct horse battery staple', hash),
    ).resolves.toBe(true);
    await expect(hasher.verify('correct horse', hash)).resolves.toBe(false);
  });

  it('normalizes to NFKC, so the same password typed differently matches', async () => {
    const composed = 'contraseña única de prueba';
    const decomposed = composed.normalize('NFD');
    const fullWidth = 'ｃｏｎｔｒａｓｅñａ única de prueba';
    const hash = await hasher.hash(composed);

    expect(decomposed).not.toBe(composed);
    await expect(hasher.verify(decomposed, hash)).resolves.toBe(true);
    await expect(hasher.verify(fullWidth, hash)).resolves.toBe(true);
  });

  it('answers false without a hash, after the same work (unknown email, ADR-0062)', async () => {
    await expect(hasher.verify(PASSWORD, null)).resolves.toBe(false);
  });

  it.each([
    [
      'another algorithm',
      '$argon2i$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNoaGFzaA',
    ],
    [
      'another version',
      '$argon2id$v=16$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNoaGFzaA',
    ],
    [
      'a memory cost over 1 GiB',
      '$argon2id$v=19$m=4194304,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNoaGFzaA',
    ],
    [
      'too many passes',
      '$argon2id$v=19$m=19456,t=100,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNoaGFzaA',
    ],
    [
      'a short salt',
      '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaGhhc2hoYXNoaGFzaA',
    ],
    ['not a PHC string', 'not-a-real-hash'],
  ])('never matches a stored hash with %s', async (_, hash) => {
    await expect(hasher.verify(PASSWORD, hash)).resolves.toBe(false);
  });
});
