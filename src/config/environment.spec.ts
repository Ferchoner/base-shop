import { isExactOrigin, validateEnvironment } from './environment.js';

describe('validateEnvironment', () => {
  it('accepts the minimal configuration and applies defaults', () => {
    const environment = validateEnvironment({ NODE_ENV: 'development' });

    expect(environment.NODE_ENV).toBe('development');
    expect(environment.PORT).toBe(3000);
    expect(environment.CORS_ALLOWED_ORIGINS).toEqual([]);
  });

  it('converts PORT to a number', () => {
    expect(validateEnvironment({ NODE_ENV: 'test', PORT: '8080' }).PORT).toBe(
      8080,
    );
  });

  it('ignores variables it does not declare', () => {
    const environment = validateEnvironment({
      NODE_ENV: 'test',
      UNRELATED: 'value',
    });

    expect(environment).not.toHaveProperty('UNRELATED');
  });

  it('rejects a missing NODE_ENV', () => {
    expect(() => validateEnvironment({})).toThrow(/NODE_ENV/);
  });

  it.each(['staging', 'PRODUCTION', ''])('rejects NODE_ENV "%s"', (value) => {
    expect(() => validateEnvironment({ NODE_ENV: value })).toThrow(/NODE_ENV/);
  });

  it.each(['abc', '0', '65536', '3000.5', ''])('rejects PORT "%s"', (value) => {
    expect(() =>
      validateEnvironment({ NODE_ENV: 'test', PORT: value }),
    ).toThrow(/PORT/);
  });

  it('parses a comma-separated list of origins, ignoring spaces and empty items', () => {
    const environment = validateEnvironment({
      NODE_ENV: 'test',
      CORS_ALLOWED_ORIGINS:
        ' http://localhost:5173 , https://shop.example.com,, ',
    });

    expect(environment.CORS_ALLOWED_ORIGINS).toEqual([
      'http://localhost:5173',
      'https://shop.example.com',
    ]);
  });

  it('treats an empty CORS_ALLOWED_ORIGINS as no allowed origins', () => {
    expect(
      validateEnvironment({ NODE_ENV: 'test', CORS_ALLOWED_ORIGINS: '' })
        .CORS_ALLOWED_ORIGINS,
    ).toEqual([]);
  });

  it.each([
    '*',
    'https://shop.example.com/',
    'https://shop.example.com/store',
    'shop.example.com',
    'ftp://shop.example.com',
    'https://*.example.com',
    'https://Shop.Example.com',
  ])('rejects the origin "%s"', (origin) => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'test',
        CORS_ALLOWED_ORIGINS: `https://valid.example.com,${origin}`,
      }),
    ).toThrow(/CORS_ALLOWED_ORIGINS/);
  });

  it('does not include rejected values in the error message', () => {
    expect(() =>
      validateEnvironment({ NODE_ENV: 'test', PORT: 'secret-looking-value' }),
    ).toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining('secret-looking-value'),
      }),
    );
  });
});

describe('isExactOrigin', () => {
  it.each([
    'http://localhost:5173',
    'https://shop.example.com',
    'https://shop.example.com:8443',
  ])('accepts "%s"', (origin) => {
    expect(isExactOrigin(origin)).toBe(true);
  });

  it.each([undefined, 42, '', 'null'])('rejects %p', (value) => {
    expect(isExactOrigin(value)).toBe(false);
  });
});
