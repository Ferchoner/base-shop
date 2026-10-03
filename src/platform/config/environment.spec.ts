import {
  isExactOrigin,
  isBaseUrl,
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

describe('MANUAL_PAYMENTS_ENABLED (ADR-0040)', () => {
  it('defaults to false: manual payments are only for tests', () => {
    expect(validateEnvironment(REQUIRED).MANUAL_PAYMENTS_ENABLED).toBe(false);
  });

  it.each([
    ['true', true],
    ['false', false],
  ])('reads %p', (value, expected) => {
    expect(
      validateEnvironment({ ...REQUIRED, MANUAL_PAYMENTS_ENABLED: value })
        .MANUAL_PAYMENTS_ENABLED,
    ).toBe(expected);
  });

  it.each(['yes', '1'])('rejects %p', (value) => {
    expect(() =>
      validateEnvironment({ ...REQUIRED, MANUAL_PAYMENTS_ENABLED: value }),
    ).toThrow(/MANUAL_PAYMENTS_ENABLED/);
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
      RATE_LIMIT_ORDER_ACCESS_EMAIL: '3/1h',
      RATE_LIMIT_ORDER_ACCESS_IP: '10/1h',
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
    IMAGE_BASE_URL: 'https://shop.example.com/media',
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

  it.each([
    'SMTP_HOST',
    'SMTP_PORT',
    'MAIL_FROM',
    'FRONTEND_BASE_URL',
    'IMAGE_BASE_URL',
  ])(
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

describe('VAT rate (ADR-0027, ADR-0122)', () => {
  it('defaults to 16%, in basis points', () => {
    expect(validateEnvironment(REQUIRED).VAT_RATE_BP).toBe(1_600);
  });

  it.each([
    ['0', 0],
    ['800', 800],
    ['10000', 10_000],
  ])('accepts VAT_RATE_BP %p', (value, rate) => {
    expect(
      validateEnvironment({ ...REQUIRED, VAT_RATE_BP: value }).VAT_RATE_BP,
    ).toBe(rate);
  });

  it.each(['-1', '10001', '16.5', 'dieciseis'])(
    'rejects VAT_RATE_BP %p',
    (value) => {
      expect(() =>
        validateEnvironment({ ...REQUIRED, VAT_RATE_BP: value }),
      ).toThrow('VAT_RATE_BP');
    },
  );
});

describe('Product images (ADR-0024, ADR-0121)', () => {
  it('defaults to a local folder served by the API at /media, and 5 MB', () => {
    expect(validateEnvironment(REQUIRED)).toMatchObject({
      IMAGE_STORAGE_DIR: 'storage/images',
      IMAGE_BASE_URL: 'http://localhost:3000/media',
      IMAGE_MAX_BYTES: 5_242_880,
    });
  });

  it('accepts another folder, base URL and a lower limit', () => {
    expect(
      validateEnvironment({
        ...REQUIRED,
        IMAGE_STORAGE_DIR: '/var/lib/base-shop/images',
        IMAGE_BASE_URL: 'https://cdn.example.com/shop',
        IMAGE_MAX_BYTES: '1048576',
      }),
    ).toMatchObject({
      IMAGE_STORAGE_DIR: '/var/lib/base-shop/images',
      IMAGE_BASE_URL: 'https://cdn.example.com/shop',
      IMAGE_MAX_BYTES: 1_048_576,
    });
  });

  it.each(['0', '5242881', '2.5', 'mucho'])(
    'rejects IMAGE_MAX_BYTES %p: the database allows 5 MB at most',
    (value) => {
      expect(() =>
        validateEnvironment({ ...REQUIRED, IMAGE_MAX_BYTES: value }),
      ).toThrow('IMAGE_MAX_BYTES');
    },
  );

  it('rejects an empty folder and a base URL with a trailing slash', () => {
    expect(() =>
      validateEnvironment({ ...REQUIRED, IMAGE_STORAGE_DIR: '' }),
    ).toThrow('IMAGE_STORAGE_DIR must not be empty');
    expect(() =>
      validateEnvironment({
        ...REQUIRED,
        IMAGE_BASE_URL: 'https://cdn.example.com/',
      }),
    ).toThrow('IMAGE_BASE_URL must be an http or https URL');
  });
});

describe('Audit archive (ADR-0037, ADR-0146)', () => {
  const ARCHIVE_INSIDE =
    'AUDIT_ARCHIVE_DIR must not be IMAGE_STORAGE_DIR nor a folder inside it, which the API serves at /media';

  it('defaults to a private folder next to the images, 3 months in the database and 24 in files', () => {
    expect(validateEnvironment(REQUIRED)).toMatchObject({
      AUDIT_ARCHIVE_DIR: 'storage/audit',
      AUDIT_RETENTION_MONTHS: 3,
      AUDIT_ARCHIVE_RETENTION_MONTHS: 24,
    });
  });

  it('accepts another folder and other retentions', () => {
    expect(
      validateEnvironment({
        ...REQUIRED,
        AUDIT_ARCHIVE_DIR: '/var/lib/base-shop/audit',
        AUDIT_RETENTION_MONTHS: '6',
        AUDIT_ARCHIVE_RETENTION_MONTHS: '120',
      }),
    ).toMatchObject({
      AUDIT_ARCHIVE_DIR: '/var/lib/base-shop/audit',
      AUDIT_RETENTION_MONTHS: 6,
      AUDIT_ARCHIVE_RETENTION_MONTHS: 120,
    });
  });

  it.each([
    ['storage/images', 'storage/images'],
    ['storage/images', './storage/images/'],
    ['storage/images', 'storage/images/audit'],
    ['storage/images', 'storage/images/..audit'],
    ['storage', 'storage/audit'],
  ])(
    'rejects an archive in the folder the API serves: images %p, archive %p',
    (images, archive) => {
      expect(() =>
        validateEnvironment({
          ...REQUIRED,
          IMAGE_STORAGE_DIR: images,
          AUDIT_ARCHIVE_DIR: archive,
        }),
      ).toThrow(ARCHIVE_INSIDE);
    },
  );

  it.each([
    ['storage/images', 'storage/images-audit'],
    ['storage/images', 'storage/..audit'],
    ['storage/images/public', 'storage/images'],
  ])(
    'accepts an archive out of the folder the API serves: images %p, archive %p',
    (images, archive) => {
      expect(
        validateEnvironment({
          ...REQUIRED,
          IMAGE_STORAGE_DIR: images,
          AUDIT_ARCHIVE_DIR: archive,
        }).AUDIT_ARCHIVE_DIR,
      ).toBe(archive);
    },
  );

  (process.platform === 'win32' ? it : it.skip)(
    'accepts an archive on another drive than the images',
    () => {
      expect(
        validateEnvironment({
          ...REQUIRED,
          IMAGE_STORAGE_DIR: 'C:\\base-shop\\images',
          AUDIT_ARCHIVE_DIR: 'D:\\base-shop\\audit',
        }).AUDIT_ARCHIVE_DIR,
      ).toBe('D:\\base-shop\\audit');
    },
  );

  it('rejects an empty folder without comparing it with the images', () => {
    const validate = () =>
      validateEnvironment({ ...REQUIRED, AUDIT_ARCHIVE_DIR: '' });

    expect(validate).toThrow('AUDIT_ARCHIVE_DIR must not be empty');
    expect(validate).not.toThrow(ARCHIVE_INSIDE);
    expect(() =>
      validateEnvironment({ ...REQUIRED, IMAGE_STORAGE_DIR: '' }),
    ).not.toThrow(ARCHIVE_INSIDE);
    // An empty folder resolves to the working directory, which here is the images.
    expect(() =>
      validateEnvironment({
        ...REQUIRED,
        IMAGE_STORAGE_DIR: '.',
        AUDIT_ARCHIVE_DIR: '',
      }),
    ).not.toThrow(ARCHIVE_INSIDE);
  });

  it.each([
    ['AUDIT_RETENTION_MONTHS', '0'],
    ['AUDIT_RETENTION_MONTHS', '25'],
    ['AUDIT_RETENTION_MONTHS', '1.5'],
    ['AUDIT_ARCHIVE_RETENTION_MONTHS', '1'],
    ['AUDIT_ARCHIVE_RETENTION_MONTHS', '241'],
  ])('rejects %s %p', (name, value) => {
    expect(() => validateEnvironment({ ...REQUIRED, [name]: value })).toThrow(
      name,
    );
  });

  it('keeps the files longer than the database keeps the records', () => {
    const shorter =
      'AUDIT_ARCHIVE_RETENTION_MONTHS must be more than AUDIT_RETENTION_MONTHS';
    for (const files of ['6', '4']) {
      expect(() =>
        validateEnvironment({
          ...REQUIRED,
          AUDIT_RETENTION_MONTHS: '6',
          AUDIT_ARCHIVE_RETENTION_MONTHS: files,
        }),
      ).toThrow(shorter);
    }
    expect(
      validateEnvironment({
        ...REQUIRED,
        AUDIT_RETENTION_MONTHS: '6',
        AUDIT_ARCHIVE_RETENTION_MONTHS: '7',
      }).AUDIT_ARCHIVE_RETENTION_MONTHS,
    ).toBe(7);
    expect(() =>
      validateEnvironment({
        ...REQUIRED,
        AUDIT_RETENTION_MONTHS: 'tres',
        AUDIT_ARCHIVE_RETENTION_MONTHS: '2',
      }),
    ).not.toThrow(shorter);
  });
});

describe('isBaseUrl', () => {
  it.each([
    'https://shop.example.com',
    'http://localhost:5173',
    'https://example.com/tienda',
  ])('accepts %p', (value) => {
    expect(isBaseUrl(value)).toBe(true);
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
    expect(isBaseUrl(value)).toBe(false);
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

describe('First superadmin (UC-IAM-20, ADR-0116)', () => {
  it('leaves the script variables unset by default, also when empty as in .env.example', () => {
    expect(
      validateEnvironment({
        ...REQUIRED,
        SUPERADMIN_EMAIL: '',
        SUPERADMIN_FIRST_NAMES: '',
        SUPERADMIN_LAST_NAMES: '',
      }),
    ).toMatchObject({
      SUPERADMIN_EMAIL: undefined,
      SUPERADMIN_FIRST_NAMES: undefined,
      SUPERADMIN_LAST_NAMES: undefined,
    });
  });

  it('keeps the email in lowercase, and the names as given', () => {
    expect(
      validateEnvironment({
        ...REQUIRED,
        SUPERADMIN_EMAIL: ' Admin@Example.COM ',
        SUPERADMIN_FIRST_NAMES: 'Ana María',
        SUPERADMIN_LAST_NAMES: 'Pérez',
      }),
    ).toMatchObject({
      SUPERADMIN_EMAIL: 'admin@example.com',
      SUPERADMIN_FIRST_NAMES: 'Ana María',
      SUPERADMIN_LAST_NAMES: 'Pérez',
    });
  });

  it('rejects an invalid email without writing it in the error', () => {
    const validate = () =>
      validateEnvironment({ ...REQUIRED, SUPERADMIN_EMAIL: 'not-an-email' });

    expect(validate).toThrow('SUPERADMIN_EMAIL must be an email address');
    expect(validate).not.toThrow('not-an-email');
  });

  it.each([
    ['blank', '   ', 'SUPERADMIN_FIRST_NAMES must not be blank'],
    [
      'too long',
      'a'.repeat(101),
      'SUPERADMIN_FIRST_NAMES must have 1 to 100 characters',
    ],
  ])('rejects %s names', (_, value, message) => {
    expect(() =>
      validateEnvironment({ ...REQUIRED, SUPERADMIN_FIRST_NAMES: value }),
    ).toThrow(message);
  });
});

describe('EMAIL_VERIFICATION_TTL (BR-USR-11, ADR-0117)', () => {
  it('defaults to 24 hours', () => {
    expect(validateEnvironment(REQUIRED).EMAIL_VERIFICATION_TTL).toBe('24h');
  });

  it.each(['1h', '48h', '7d'])('accepts %p', (value) => {
    expect(
      validateEnvironment({ ...REQUIRED, EMAIL_VERIFICATION_TTL: value })
        .EMAIL_VERIFICATION_TTL,
    ).toBe(value);
  });

  it.each(['59m', '8d', '24'])('rejects %p', (value) => {
    expect(() =>
      validateEnvironment({ ...REQUIRED, EMAIL_VERIFICATION_TTL: value }),
    ).toThrow(
      'EMAIL_VERIFICATION_TTL must be a duration such as 15m or 7d (s, m, h or d), from 1h to 7d',
    );
  });
});

describe('PASSWORD_RESET_TTL (BR-USR-16, ADR-0118)', () => {
  it('defaults to 30 minutes', () => {
    expect(validateEnvironment(REQUIRED).PASSWORD_RESET_TTL).toBe('30m');
  });

  it.each(['5m', '1h', '2h'])('accepts %p', (value) => {
    expect(
      validateEnvironment({ ...REQUIRED, PASSWORD_RESET_TTL: value })
        .PASSWORD_RESET_TTL,
    ).toBe(value);
  });

  it.each(['4m', '121m', '1d'])('rejects %p', (value) => {
    expect(() =>
      validateEnvironment({ ...REQUIRED, PASSWORD_RESET_TTL: value }),
    ).toThrow(
      'PASSWORD_RESET_TTL must be a duration such as 15m or 7d (s, m, h or d), from 5m to 2h',
    );
  });
});

describe('Retention of personal data and records (ADR-0070, ADR-0149)', () => {
  it('defaults to the cycle enabled: 12 months visible, 60 blocked, and 30 days for the records', () => {
    expect(validateEnvironment(REQUIRED)).toMatchObject({
      PERSONAL_DATA_RETENTION_ENABLED: true,
      PERSONAL_DATA_OPERATIONAL_MONTHS: 12,
      PERSONAL_DATA_BLOCKED_MONTHS: 60,
      SPENT_REFRESH_TOKEN_RETENTION_DAYS: 30,
      INACTIVE_GUEST_CART_RETENTION_DAYS: 30,
      PROCESSED_WEBHOOK_EVENT_RETENTION_DAYS: 30,
    });
  });

  it.each([
    ['true', true],
    ['false', false],
  ])('reads PERSONAL_DATA_RETENTION_ENABLED %p', (value, expected) => {
    expect(
      validateEnvironment({
        ...REQUIRED,
        PERSONAL_DATA_RETENTION_ENABLED: value,
      }).PERSONAL_DATA_RETENTION_ENABLED,
    ).toBe(expected);
  });

  it.each([
    ['PERSONAL_DATA_OPERATIONAL_MONTHS', '1'],
    ['PERSONAL_DATA_OPERATIONAL_MONTHS', '120'],
    ['PERSONAL_DATA_BLOCKED_MONTHS', '0'],
    ['PERSONAL_DATA_BLOCKED_MONTHS', '240'],
    ['SPENT_REFRESH_TOKEN_RETENTION_DAYS', '1'],
    ['SPENT_REFRESH_TOKEN_RETENTION_DAYS', '365'],
    ['INACTIVE_GUEST_CART_RETENTION_DAYS', '1'],
    ['INACTIVE_GUEST_CART_RETENTION_DAYS', '365'],
    ['PROCESSED_WEBHOOK_EVENT_RETENTION_DAYS', '7'],
    ['PROCESSED_WEBHOOK_EVENT_RETENTION_DAYS', '365'],
  ])('accepts %s %p', (name, value) => {
    expect(
      validateEnvironment({ ...REQUIRED, [name]: value })[
        name as keyof ReturnType<typeof validateEnvironment>
      ],
    ).toBe(Number(value));
  });

  it.each([
    ['PERSONAL_DATA_RETENTION_ENABLED', 'yes'],
    ['PERSONAL_DATA_OPERATIONAL_MONTHS', '0'],
    ['PERSONAL_DATA_OPERATIONAL_MONTHS', '121'],
    ['PERSONAL_DATA_OPERATIONAL_MONTHS', '1.5'],
    ['PERSONAL_DATA_BLOCKED_MONTHS', '-1'],
    ['PERSONAL_DATA_BLOCKED_MONTHS', '241'],
    ['SPENT_REFRESH_TOKEN_RETENTION_DAYS', '0'],
    ['SPENT_REFRESH_TOKEN_RETENTION_DAYS', '366'],
    ['INACTIVE_GUEST_CART_RETENTION_DAYS', '0'],
    ['INACTIVE_GUEST_CART_RETENTION_DAYS', '366'],
    ['INACTIVE_GUEST_CART_RETENTION_DAYS', 'month'],
    ['PROCESSED_WEBHOOK_EVENT_RETENTION_DAYS', '6'],
    ['PROCESSED_WEBHOOK_EVENT_RETENTION_DAYS', '366'],
  ])('rejects %s %p', (name, value) => {
    expect(() => validateEnvironment({ ...REQUIRED, [name]: value })).toThrow(
      name,
    );
  });
});

describe('DELIVERED_EVENT_RETENTION_DAYS (ADR-0150)', () => {
  it('defaults to 7 days', () => {
    expect(validateEnvironment(REQUIRED).DELIVERED_EVENT_RETENTION_DAYS).toBe(
      7,
    );
  });

  it.each(['1', '90'])('accepts %p', (value) => {
    expect(
      validateEnvironment({
        ...REQUIRED,
        DELIVERED_EVENT_RETENTION_DAYS: value,
      }).DELIVERED_EVENT_RETENTION_DAYS,
    ).toBe(Number(value));
  });

  it.each(['0', '91', '7.5', 'week'])('rejects %p', (value) => {
    expect(() =>
      validateEnvironment({
        ...REQUIRED,
        DELIVERED_EVENT_RETENTION_DAYS: value,
      }),
    ).toThrow(/DELIVERED_EVENT_RETENTION_DAYS/);
  });
});

describe('ORDER_ACCESS_LINK_TTL (UC-ORD-05, ADR-0148)', () => {
  it('defaults to 30 minutes', () => {
    expect(validateEnvironment(REQUIRED).ORDER_ACCESS_LINK_TTL).toBe('30m');
  });

  it.each(['5m', '1h', '2h'])('accepts %p', (value) => {
    expect(
      validateEnvironment({ ...REQUIRED, ORDER_ACCESS_LINK_TTL: value })
        .ORDER_ACCESS_LINK_TTL,
    ).toBe(value);
  });

  it.each(['4m', '121m', '1d'])('rejects %p', (value) => {
    expect(() =>
      validateEnvironment({ ...REQUIRED, ORDER_ACCESS_LINK_TTL: value }),
    ).toThrow(
      'ORDER_ACCESS_LINK_TTL must be a duration such as 15m or 7d (s, m, h or d), from 5m to 2h',
    );
  });
});

describe('RESERVATION_TTL (BR-INV-07, ADR-0128)', () => {
  it('defaults to 20 minutes', () => {
    expect(validateEnvironment(REQUIRED).RESERVATION_TTL).toBe('20m');
  });

  it.each(['5m', '20m', '2h'])('accepts %p', (value) => {
    expect(
      validateEnvironment({ ...REQUIRED, RESERVATION_TTL: value })
        .RESERVATION_TTL,
    ).toBe(value);
  });

  it.each(['4m', '121m', '1d'])('rejects %p', (value) => {
    expect(() =>
      validateEnvironment({ ...REQUIRED, RESERVATION_TTL: value }),
    ).toThrow(
      'RESERVATION_TTL must be a duration such as 15m or 7d (s, m, h or d), from 5m to 2h',
    );
  });
});
