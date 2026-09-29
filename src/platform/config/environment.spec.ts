import {
  isExactOrigin,
  isFrontendBaseUrl,
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

describe('JOBS_ENABLED (ADR-0101)', () => {
  it('defaults to true', () => {
    expect(validateEnvironment(REQUIRED).JOBS_ENABLED).toBe(true);
  });

  it.each([
    ['true', true],
    ['false', false],
  ])('reads %p', (value, expected) => {
    expect(
      validateEnvironment({ ...REQUIRED, JOBS_ENABLED: value }).JOBS_ENABLED,
    ).toBe(expected);
  });

  it.each(['yes', '1', 'TRUE'])('rejects %p', (value) => {
    expect(() =>
      validateEnvironment({ ...REQUIRED, JOBS_ENABLED: value }),
    ).toThrow(/JOBS_ENABLED/);
  });
});

describe('RATE_LIMIT_* (ADR-0065, ADR-0102)', () => {
  it('defaults to the limits of ADR-0065', () => {
    expect(validateEnvironment(REQUIRED)).toMatchObject({
      RATE_LIMIT_DEFAULT: '100/1m',
      RATE_LIMIT_LOGIN_EMAIL: '5/15m',
      RATE_LIMIT_LOGIN_IP: '20/15m',
      RATE_LIMIT_REGISTER: '5/1h',
      RATE_LIMIT_PASSWORD_RESET_EMAIL: '3/1h',
      RATE_LIMIT_PASSWORD_RESET_IP: '10/1h',
      RATE_LIMIT_EMAIL_VERIFICATION: '3/1h',
      RATE_LIMIT_GUEST_ORDER: '10/15m',
      RATE_LIMIT_PLACE_ORDER: '10/10m',
    });
  });

  it('accepts another value', () => {
    expect(
      validateEnvironment({ ...REQUIRED, RATE_LIMIT_REGISTER: '20/30m' })
        .RATE_LIMIT_REGISTER,
    ).toBe('20/30m');
  });

  it.each(['5', '5/15', '0/1m', 'many'])('rejects %p', (value) => {
    expect(() =>
      validateEnvironment({ ...REQUIRED, RATE_LIMIT_REGISTER: value }),
    ).toThrow(/RATE_LIMIT_REGISTER must look like 5\/15m/);
  });
});

describe('Email and frontend links (ADR-0110)', () => {
  /** Production with every variable it requires. */
  const PRODUCTION = {
    ...REQUIRED,
    NODE_ENV: 'production',
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: '587',
    MAIL_FROM: 'Tienda <no-reply@example.com>',
    FRONTEND_BASE_URL: 'https://shop.example.com',
    JWT_SECRET: 'x'.repeat(32),
  };

  it('defaults to Mailpit and a local frontend in development and test', () => {
    expect(validateEnvironment(REQUIRED)).toMatchObject({
      SMTP_HOST: 'localhost',
      SMTP_PORT: 1025,
      MAIL_FROM: 'base-shop <no-reply@base-shop.test>',
      FRONTEND_BASE_URL: 'http://localhost:5173',
    });
  });

  it('accepts a complete production configuration', () => {
    expect(validateEnvironment(PRODUCTION)).toMatchObject({
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: 587,
      FRONTEND_BASE_URL: 'https://shop.example.com',
    });
  });

  it.each(['SMTP_HOST', 'SMTP_PORT', 'MAIL_FROM', 'FRONTEND_BASE_URL'])(
    'requires %s in production, so emails never go to the defaults',
    (name) => {
      const withoutIt: Record<string, unknown> = { ...PRODUCTION };
      delete withoutIt[name];

      expect(() => validateEnvironment(withoutIt)).toThrow(
        `${name} is required when NODE_ENV is production`,
      );
      expect(() => validateEnvironment({ ...PRODUCTION, [name]: '' })).toThrow(
        name,
      );
    },
  );

  it.each([
    'no-reply@example.com',
    'Tienda <no-reply@example.com>',
    'Café Ñandú <hola@example.com.mx>',
  ])('accepts MAIL_FROM %p', (value) => {
    expect(
      validateEnvironment({ ...REQUIRED, MAIL_FROM: value }).MAIL_FROM,
    ).toBe(value);
  });

  it.each([
    'no-reply',
    'Tienda no-reply@example.com',
    'Tienda <no-reply@example.com>\r\nBcc: someone@example.com',
    'Tienda\r\nBcc: someone@example.com <no-reply@example.com>',
    'Tienda\nBcc: someone@example.com <no-reply@example.com>',
    '<no-reply@example.com>',
  ])('rejects MAIL_FROM %p, including a second header line', (value) => {
    expect(() =>
      validateEnvironment({ ...REQUIRED, MAIL_FROM: value }),
    ).toThrow(/MAIL_FROM must be an email address/);
  });

  it.each(['smtp host', '-smtp.example.com', 'smtp.example.com.'])(
    'rejects SMTP_HOST %p',
    (value) => {
      expect(() =>
        validateEnvironment({ ...REQUIRED, SMTP_HOST: value }),
      ).toThrow(/SMTP_HOST must be a host name/);
    },
  );

  it.each(['0', '65536', 'smtp'])('rejects SMTP_PORT %p', (value) => {
    expect(() =>
      validateEnvironment({ ...REQUIRED, SMTP_PORT: value }),
    ).toThrow(/SMTP_PORT/);
  });
});

describe('isFrontendBaseUrl', () => {
  it.each([
    'https://shop.example.com',
    'http://localhost:5173',
    'https://example.com/tienda',
  ])('accepts %p', (value) => {
    expect(isFrontendBaseUrl(value)).toBe(true);
  });

  it.each([
    'https://shop.example.com/',
    'https://shop.example.com?ref=email',
    'https://shop.example.com#top',
    'https://user:secret@shop.example.com',
    'ftp://shop.example.com',
    'javascript:alert(1)',
    'shop.example.com',
    42,
  ])('rejects %p', (value) => {
    expect(isFrontendBaseUrl(value)).toBe(false);
  });
});

describe('MAX_ADDRESSES_PER_CUSTOMER (BR-ADR-04, ADR-0113)', () => {
  it('defaults to 10', () => {
    expect(validateEnvironment(REQUIRED).MAX_ADDRESSES_PER_CUSTOMER).toBe(10);
  });

  it('accepts another whole number from 1 to 100', () => {
    expect(
      validateEnvironment({ ...REQUIRED, MAX_ADDRESSES_PER_CUSTOMER: '25' })
        .MAX_ADDRESSES_PER_CUSTOMER,
    ).toBe(25);
  });

  it.each(['0', '101', '2.5', 'ten'])('rejects %p', (value) => {
    expect(() =>
      validateEnvironment({ ...REQUIRED, MAX_ADDRESSES_PER_CUSTOMER: value }),
    ).toThrow(/MAX_ADDRESSES_PER_CUSTOMER/);
  });
});

describe('Sessions (ADR-0023, ADR-0114)', () => {
  const SECRET = 'x'.repeat(32);

  it('has no signing key by default, and the token lifetimes of ADR-0023', () => {
    expect(validateEnvironment(REQUIRED)).toMatchObject({
      JWT_SECRET: undefined,
      ACCESS_TOKEN_TTL: '15m',
      REFRESH_TOKEN_TTL: '7d',
    });
  });

  it('treats an empty JWT_SECRET as unset, as in a copied .env.example', () => {
    expect(
      validateEnvironment({ ...REQUIRED, JWT_SECRET: '' }).JWT_SECRET,
    ).toBeUndefined();
  });

  it('accepts a JWT_SECRET of at least 32 characters', () => {
    expect(
      validateEnvironment({ ...REQUIRED, JWT_SECRET: SECRET }).JWT_SECRET,
    ).toBe(SECRET);
  });

  it('rejects a shorter JWT_SECRET without writing it in the error', () => {
    const secret = 'y'.repeat(31);
    const validate = () =>
      validateEnvironment({ ...REQUIRED, JWT_SECRET: secret });

    expect(validate).toThrow('JWT_SECRET must have at least 32 characters');
    expect(validate).not.toThrow(secret);
  });

  it.each([undefined, ''])(
    'requires JWT_SECRET in production (%p)',
    (value) => {
      expect(() =>
        validateEnvironment({
          ...REQUIRED,
          NODE_ENV: 'production',
          JWT_SECRET: value,
        }),
      ).toThrow('JWT_SECRET is required when NODE_ENV is production');
    },
  );

  it.each(['1m', '15m', '60m', '1h', '3600s'])(
    'accepts ACCESS_TOKEN_TTL %p',
    (value) => {
      expect(
        validateEnvironment({ ...REQUIRED, ACCESS_TOKEN_TTL: value })
          .ACCESS_TOKEN_TTL,
      ).toBe(value);
    },
  );

  it.each(['59s', '61m', '2h', '1d', '15', 'soon'])(
    'rejects ACCESS_TOKEN_TTL %p',
    (value) => {
      expect(() =>
        validateEnvironment({ ...REQUIRED, ACCESS_TOKEN_TTL: value }),
      ).toThrow(
        'ACCESS_TOKEN_TTL must be a duration such as 15m or 7d (s, m, h or d), from 1m to 1h',
      );
    },
  );

  it.each(['1h', '60m', '7d', '90d'])(
    'accepts REFRESH_TOKEN_TTL %p',
    (value) => {
      expect(
        validateEnvironment({ ...REQUIRED, REFRESH_TOKEN_TTL: value })
          .REFRESH_TOKEN_TTL,
      ).toBe(value);
    },
  );

  it.each(['59m', '91d', '7', '1w'])(
    'rejects REFRESH_TOKEN_TTL %p',
    (value) => {
      expect(() =>
        validateEnvironment({ ...REQUIRED, REFRESH_TOKEN_TTL: value }),
      ).toThrow(/REFRESH_TOKEN_TTL must be a duration .*, from 1h to 90d/);
    },
  );
});
