import {
  isExactOrigin,
  isPostgresUrl,
  validateEnvironment,
} from './environment.js';

/** Required variables with valid values; each test overrides what it checks. */
const REQUIRED = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://shop:example@localhost:5432/shop',
};

describe('validateEnvironment', () => {
  it('accepts the minimal configuration and applies defaults', () => {
    const environment = validateEnvironment({
      ...REQUIRED,
      NODE_ENV: 'development',
    });

    expect(environment.NODE_ENV).toBe('development');
    expect(environment.PORT).toBe(3000);
    expect(environment.CORS_ALLOWED_ORIGINS).toEqual([]);
    expect(environment.DATABASE_URL).toBe(REQUIRED.DATABASE_URL);
  });

  it('converts PORT to a number', () => {
    expect(validateEnvironment({ ...REQUIRED, PORT: '8080' }).PORT).toBe(8080);
  });

  it('ignores variables it does not declare', () => {
    const environment = validateEnvironment({
      ...REQUIRED,
      UNRELATED: 'value',
    });

    expect(environment).not.toHaveProperty('UNRELATED');
  });

  it('rejects a missing NODE_ENV', () => {
    expect(() =>
      validateEnvironment({ DATABASE_URL: REQUIRED.DATABASE_URL }),
    ).toThrow(/NODE_ENV/);
  });

  it.each(['staging', 'PRODUCTION', ''])('rejects NODE_ENV "%s"', (value) => {
    expect(() => validateEnvironment({ ...REQUIRED, NODE_ENV: value })).toThrow(
      /NODE_ENV/,
    );
  });

  it.each(['abc', '0', '65536', '3000.5', ''])('rejects PORT "%s"', (value) => {
    expect(() => validateEnvironment({ ...REQUIRED, PORT: value })).toThrow(
      /PORT/,
    );
  });

  it('parses a comma-separated list of origins, ignoring spaces and empty items', () => {
    const environment = validateEnvironment({
      ...REQUIRED,
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
      validateEnvironment({ ...REQUIRED, CORS_ALLOWED_ORIGINS: '' })
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
        ...REQUIRED,
        CORS_ALLOWED_ORIGINS: `https://valid.example.com,${origin}`,
      }),
    ).toThrow(/CORS_ALLOWED_ORIGINS/);
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(() => validateEnvironment({ NODE_ENV: 'test' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it.each([
    'mysql://shop:example@localhost:3306/shop',
    'localhost:5432/shop',
    'not a url',
    '',
  ])('rejects DATABASE_URL "%s"', (value) => {
    expect(() =>
      validateEnvironment({ ...REQUIRED, DATABASE_URL: value }),
    ).toThrow(/DATABASE_URL/);
  });

  it('does not include rejected values in the error message', () => {
    const secret = 'mysql://admin:secret-looking-value@db:3306/shop';

    expect(() =>
      validateEnvironment({
        ...REQUIRED,
        PORT: 'secret-looking-value',
        DATABASE_URL: secret,
      }),
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

describe('isPostgresUrl', () => {
  it.each([
    'postgresql://shop:example@localhost:5432/shop',
    'postgres://shop@db/shop',
  ])('accepts "%s"', (value) => {
    expect(isPostgresUrl(value)).toBe(true);
  });

  it.each([undefined, 42, 'postgresql://', 'http://localhost/shop'])(
    'rejects %p',
    (value) => {
      expect(isPostgresUrl(value)).toBe(false);
    },
  );
});

describe('LOG_LEVEL (ADR-0097)', () => {
  it('defaults to log', () => {
    expect(validateEnvironment(REQUIRED).LOG_LEVEL).toBe('log');
  });

  it.each(['fatal', 'error', 'warn', 'log', 'debug', 'verbose'])(
    'accepts %s',
    (level) => {
      expect(
        validateEnvironment({ ...REQUIRED, LOG_LEVEL: level }).LOG_LEVEL,
      ).toBe(level);
    },
  );

  it.each(['trace', 'LOG', 'info'])('rejects %p', (level) => {
    expect(() =>
      validateEnvironment({ ...REQUIRED, LOG_LEVEL: level }),
    ).toThrow(/LOG_LEVEL/);
  });
});
