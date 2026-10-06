// class-transformer's @Type reads decorator metadata; load the polyfill here so this module works on its own.
import 'reflect-metadata';
import path from 'node:path';
import { Expose, plainToInstance, Transform, Type } from 'class-transformer';
import {
  buildMessage,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateBy,
  validateSync,
  type ValidationOptions,
} from 'class-validator';
import { durationSeconds } from './duration.js';
import { RATE_LIMIT_PATTERN } from './rate-limit-value.js';

/** An address, or `Name <address>`; one line only, so it cannot inject email headers. */
const MAIL_FROM_PATTERN =
  /^(?:[^<>\r\n]+ <[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>|[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)$/;

export const NODE_ENVIRONMENTS = ['development', 'test', 'production'] as const;
export type NodeEnvironment = (typeof NODE_ENVIRONMENTS)[number];

/** Log levels from the most to the least severe (ADR-0097). */
export const LOG_LEVELS = [
  'fatal',
  'error',
  'warn',
  'log',
  'debug',
  'verbose',
] as const;
export type LogLevelName = (typeof LOG_LEVELS)[number];

/**
 * Environment variables read at startup (ADR-0032). Every variable declared here
 * must also be listed in `.env.example` with a description and a non-real example.
 */
export class EnvironmentVariables {
  @Expose()
  @IsIn(NODE_ENVIRONMENTS)
  NODE_ENV: NodeEnvironment;

  @Expose()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  /** Exact origins allowed by CORS; empty means no cross-origin browser access (ADR-0085). */
  @Expose()
  @Transform(({ value }: { value: unknown }) => parseCommaSeparatedList(value))
  @IsExactOrigin({ each: true })
  CORS_ALLOWED_ORIGINS: string[] = [];

  /** PostgreSQL connection string used by Prisma (ADR-0091). */
  @Expose()
  @IsPostgresUrl()
  DATABASE_URL: string;

  /** Least severe level written to the console; every more severe level is written too (ADR-0032, ADR-0097). */
  @Expose()
  @IsIn(LOG_LEVELS)
  LOG_LEVEL: LogLevelName = 'log';

  /** Whether the scheduler runs the jobs (ADR-0101); the tests turn it off. */
  @Expose()
  @Transform(({ value }: { value: unknown }) => parseBoolean(value))
  @IsBoolean()
  JOBS_ENABLED: boolean = true;

  /** Seconds a cached value lives (ADR-0028, ADR-0104). */
  @Expose()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(86400)
  CACHE_TTL_SECONDS: number = 120;

  /**
   * VAT rate in basis points (1600 is 16%), a setting and not a constant (ADR-0027, ADR-0122): from 0 to 10000.
   * Every price and the shipping cost include it; orders keep the rate they applied, so a change never alters
   * placed orders.
   */
  @Expose()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  VAT_RATE_BP: number = 1_600;

  /**
   * How long a reservation of stock holds it while the order waits for its payment, from 5 minutes to 2 hours
   * (BR-INV-07, ADR-0011, ADR-0128). The expiration job of T-230 frees it within the next minute.
   */
  @Expose()
  @IsDurationWithin(300, 7_200, 'from 5m to 2h')
  RESERVATION_TTL: string = '20m';

  /** Addresses a customer can keep (BR-ADR-04, ADR-0057, ADR-0113). */
  @Expose()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  MAX_ADDRESSES_PER_CUSTOMER: number = 10;

  /** Requests per IP on every endpoint, also on those with specific limits. Format `<count>/<duration>` (ADR-0065, ADR-0102, ADR-0154). */
  @Expose()
  @Matches(RATE_LIMIT_PATTERN, {
    message: '$property must look like 5/15m (count / duration in s, m or h)',
  })
  RATE_LIMIT_DEFAULT: string = '100/1m';

  /** Failed logins per IP. Format `<count>/<duration>` (ADR-0065, ADR-0102). */
  @Expose()
  @Matches(RATE_LIMIT_PATTERN, {
    message: '$property must look like 5/15m (count / duration in s, m or h)',
  })
  RATE_LIMIT_LOGIN_IP: string = '20/15m';

  /** Wrong current passwords per user when changing the password. Format `<count>/<duration>` (ADR-0154). */
  @Expose()
  @Matches(RATE_LIMIT_PATTERN, {
    message: '$property must look like 5/15m (count / duration in s, m or h)',
  })
  RATE_LIMIT_PASSWORD_CHANGE: string = '5/15m';

  /** Sign-ups per IP. Format `<count>/<duration>` (ADR-0065, ADR-0102). */
  @Expose()
  @Matches(RATE_LIMIT_PATTERN, {
    message: '$property must look like 5/15m (count / duration in s, m or h)',
  })
  RATE_LIMIT_REGISTER: string = '5/1h';

  /** Password reset requests per email. Format `<count>/<duration>` (ADR-0065, ADR-0102). */
  @Expose()
  @Matches(RATE_LIMIT_PATTERN, {
    message: '$property must look like 5/15m (count / duration in s, m or h)',
  })
  RATE_LIMIT_PASSWORD_RESET_EMAIL: string = '3/1h';

  /** Password reset requests per IP. Format `<count>/<duration>` (ADR-0065, ADR-0102). */
  @Expose()
  @Matches(RATE_LIMIT_PATTERN, {
    message: '$property must look like 5/15m (count / duration in s, m or h)',
  })
  RATE_LIMIT_PASSWORD_RESET_IP: string = '10/1h';

  /** Verification emails per email or signed-in user (resend and email change). Format `<count>/<duration>` (ADR-0065, ADR-0102). */
  @Expose()
  @Matches(RATE_LIMIT_PATTERN, {
    message: '$property must look like 5/15m (count / duration in s, m or h)',
  })
  RATE_LIMIT_EMAIL_VERIFICATION: string = '3/1h';

  /** Guest order lookups, reorders and uses of an access link, per IP. Format `<count>/<duration>` (ADR-0065, ADR-0102). */
  @Expose()
  @Matches(RATE_LIMIT_PATTERN, {
    message: '$property must look like 5/15m (count / duration in s, m or h)',
  })
  RATE_LIMIT_GUEST_ORDER: string = '10/15m';

  /** Requests of an access link to the guest orders, per email. Format `<count>/<duration>` (ADR-0065, ADR-0148). */
  @Expose()
  @Matches(RATE_LIMIT_PATTERN, {
    message: '$property must look like 5/15m (count / duration in s, m or h)',
  })
  RATE_LIMIT_ORDER_ACCESS_EMAIL: string = '3/1h';

  /** Requests of an access link to the guest orders, per IP. Format `<count>/<duration>` (ADR-0065, ADR-0148). */
  @Expose()
  @Matches(RATE_LIMIT_PATTERN, {
    message: '$property must look like 5/15m (count / duration in s, m or h)',
  })
  RATE_LIMIT_ORDER_ACCESS_IP: string = '10/1h';

  /** Orders placed per user or cart. Format `<count>/<duration>` (ADR-0065, ADR-0102). */
  @Expose()
  @Matches(RATE_LIMIT_PATTERN, {
    message: '$property must look like 5/15m (count / duration in s, m or h)',
  })
  RATE_LIMIT_PLACE_ORDER: string = '10/10m';

  /** Guest orders placed per contact email. Format `<count>/<duration>` (ADR-0154). */
  @Expose()
  @Matches(RATE_LIMIT_PATTERN, {
    message: '$property must look like 5/15m (count / duration in s, m or h)',
  })
  RATE_LIMIT_PLACE_ORDER_EMAIL: string = '5/1h';

  /**
   * Orders a staff member places in the physical store: each one reserves stock, so an account taken over cannot hold
   * all of it. Format `<count>/<duration>` (ADR-0161).
   */
  @Expose()
  @Matches(RATE_LIMIT_PATTERN, {
    message: '$property must look like 5/15m (count / duration in s, m or h)',
  })
  RATE_LIMIT_ADMIN_PLACE_ORDER: string = '30/10m';

  /** Host name or IP of the SMTP server (ADR-0045, ADR-0110): Mailpit in development. Required in production. */
  @Expose()
  @IsNotEmpty()
  @Matches(/^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/, {
    message:
      '$property must be a host name or IP address, such as smtp.example.com',
  })
  SMTP_HOST: string = 'localhost';

  /** Port of the SMTP server; 465 uses TLS from the start. Required in production. */
  @Expose()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  SMTP_PORT: number = 1025;

  /** Sender of every email: `address` or `Name <address>`. Required in production. */
  @Expose()
  @Matches(MAIL_FROM_PATTERN, {
    message:
      '$property must be an email address or "Name <address>", on one line',
  })
  MAIL_FROM: string = 'base-shop <no-reply@base-shop.test>';

  /** Base URL of the frontend for the links in emails (ADR-0056, ADR-0110). Required in production, with https. */
  @Expose()
  @IsBaseUrl()
  FRONTEND_BASE_URL: string = 'http://localhost:5173';

  /**
   * Folder of the product images on the server's disk, absolute or relative to the working directory
   * (ADR-0024, ADR-0121). In Docker it must be a persistent volume, and it belongs in the backups.
   */
  @Expose()
  @IsNotEmpty({ message: '$property must not be empty' })
  IMAGE_STORAGE_DIR: string = 'storage/images';

  /**
   * Public base URL of the product images: each image URL is this plus its key (ADR-0024, ADR-0121). The API
   * serves them at /media until the hosting chooses another server (P-06). Required in production.
   */
  @Expose()
  @IsBaseUrl()
  IMAGE_BASE_URL: string = 'http://localhost:3000/media';

  /**
   * Largest product image in bytes (BR-PRD-08): 5 MB at most, the limit of the `CHECK` on
   * `product_images.size_bytes` (DATABASE.md §4.6). A higher limit needs a migration first.
   */
  @Expose()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5_242_880)
  IMAGE_MAX_BYTES: number = 5_242_880;

  /**
   * Folder of the archive files of the audit trail on the server's disk, absolute or relative to the working
   * directory (ADR-0037, ADR-0146). Private: never IMAGE_STORAGE_DIR nor a folder inside it, which the API serves.
   * In Docker it must be a persistent volume, and it belongs in the backups.
   */
  @Expose()
  @IsNotEmpty({ message: '$property must not be empty' })
  AUDIT_ARCHIVE_DIR: string = 'storage/audit';

  /**
   * Whether the personal data of orders and shipments follows its retention cycle: blocked when the operational phase
   * ends, anonymized when the blocked one does (ADR-0070, ADR-0149). The defaults are no legal advice: each operator
   * validates them before operating.
   */
  @Expose()
  @Transform(({ value }: { value: unknown }) => parseBoolean(value))
  @IsBoolean()
  PERSONAL_DATA_RETENTION_ENABLED: boolean = true;

  /** Months the personal data of an order stays visible after the order concluded: from 1 to 120 (ADR-0149). */
  @Expose()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  PERSONAL_DATA_OPERATIONAL_MONTHS: number = 12;

  /**
   * Months the personal data of an order stays blocked, hidden, before it is anonymized: from 0 to 240; with 0, it is
   * anonymized when the operational phase ends (ADR-0149).
   */
  @Expose()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(240)
  PERSONAL_DATA_BLOCKED_MONTHS: number = 60;

  /**
   * Months without activity (signing up, signing in or renewing the session) after which the account of a customer is
   * anonymized: from 12 to 240; unset or empty, never, which is the default (ADR-0149, ADR-0152). Its orders follow
   * their own retention cycle.
   */
  @Expose()
  @Transform(({ value }: { value: unknown }) =>
    value === undefined || value === '' ? undefined : Number(value),
  )
  @IsOptional()
  @IsInt()
  @Min(12)
  @Max(240)
  INACTIVE_CUSTOMER_ANONYMIZATION_MONTHS?: number;

  /** Days a refresh token stays after it expired or was revoked, to detect its reuse: from 1 to 365 (ADR-0149). */
  @Expose()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  SPENT_REFRESH_TOKEN_RETENTION_DAYS: number = 30;

  /** Days a guest cart stays without activity: from 1 to 365 (BR-CRT-06, ADR-0149). */
  @Expose()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  INACTIVE_GUEST_CART_RETENTION_DAYS: number = 30;

  /**
   * Days a processed webhook event stays, to discard its repeats: from 7 to 365, so the retries of a payment provider
   * are covered (ADR-0149).
   */
  @Expose()
  @Type(() => Number)
  @IsInt()
  @Min(7)
  @Max(365)
  PROCESSED_WEBHOOK_EVENT_RETENTION_DAYS: number = 30;

  /**
   * Days a domain event stays after all its deliveries succeeded, for diagnosis: from 1 to 90 (ADR-0149, ADR-0150).
   * Events with a delivery pending or failed stay until it is delivered.
   */
  @Expose()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  DELIVERED_EVENT_RETENTION_DAYS: number = 7;

  /** Months the audit trail stays in the database before it is archived: from 1 to 24 (ADR-0037, P-61). */
  @Expose()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  AUDIT_RETENTION_MONTHS: number = 3;

  /**
   * Months an archive file of the audit trail is kept, counted from its day: from 2 to 240, and more than
   * AUDIT_RETENTION_MONTHS, so no file is deleted before its records would have left the database (ADR-0037, P-61).
   */
  @Expose()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(240)
  AUDIT_ARCHIVE_RETENTION_MONTHS: number = 24;

  /**
   * Key that signs the access tokens with HS256 (ADR-0023, ADR-0114): at least 32 characters. Required in
   * production; without it, development and test sign with a random key generated at startup.
   */
  @Expose()
  @Transform(({ value }: { value: unknown }) =>
    value === '' ? undefined : value,
  )
  @IsOptional()
  @MinLength(32, { message: '$property must have at least 32 characters' })
  JWT_SECRET?: string;

  /** Lifetime of an access token, from 1 minute to 1 hour (ADR-0023, ADR-0114). */
  @Expose()
  @IsDurationWithin(60, 3_600, 'from 1m to 1h')
  ACCESS_TOKEN_TTL: string = '15m';

  /** Lifetime of a refresh token, renewed on every use: from 1 hour to 90 days (ADR-0023, ADR-0114). */
  @Expose()
  @IsDurationWithin(3_600, 90 * 86_400, 'from 1h to 90d')
  REFRESH_TOKEN_TTL: string = '7d';

  /** Lifetime of an email verification link, from 1 hour to 7 days (BR-USR-11, ADR-0046, ADR-0117). */
  @Expose()
  @IsDurationWithin(3_600, 7 * 86_400, 'from 1h to 7d')
  EMAIL_VERIFICATION_TTL: string = '24h';

  /** Lifetime of a password recovery link, from 5 minutes to 2 hours (BR-USR-16, ADR-0056, ADR-0118). */
  @Expose()
  @IsDurationWithin(300, 7_200, 'from 5m to 2h')
  PASSWORD_RESET_TTL: string = '30m';

  /** Lifetime of an access link to the guest orders of an email, from 5 minutes to 2 hours (UC-ORD-05, ADR-0148). */
  @Expose()
  @IsDurationWithin(300, 7_200, 'from 5m to 2h')
  ORDER_ACCESS_LINK_TTL: string = '30m';

  /**
   * Email of the first superadmin, read only by the script that creates it (UC-IAM-20, ADR-0116). Optional:
   * the API never uses it.
   */
  @Expose()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && value !== ''
      ? value.trim().toLowerCase()
      : undefined,
  )
  @IsOptional()
  @IsEmail({}, { message: '$property must be an email address' })
  @MaxLength(254, { message: '$property must have at most 254 characters' })
  SUPERADMIN_EMAIL?: string;

  /** First names of the first superadmin, for the same script: 1 to 100 characters. */
  @Expose()
  @Transform(({ value }: { value: unknown }) =>
    value === '' ? undefined : value,
  )
  @IsOptional()
  @Length(1, 100, { message: '$property must have 1 to 100 characters' })
  @Matches(/\S/, { message: '$property must not be blank' })
  SUPERADMIN_FIRST_NAMES?: string;

  /** Last names of the first superadmin, for the same script: 1 to 100 characters. */
  @Expose()
  @Transform(({ value }: { value: unknown }) =>
    value === '' ? undefined : value,
  )
  @IsOptional()
  @Length(1, 100, { message: '$property must have 1 to 100 characters' })
  @Matches(/\S/, { message: '$property must not be blank' })
  SUPERADMIN_LAST_NAMES?: string;
}

/**
 * Variables that production must set explicitly. With the development defaults, emails would go nowhere and
 * their links would point to localhost (ADR-0110), access tokens would be signed with a key that changes on
 * every restart (ADR-0114), and image URLs would point to localhost (ADR-0121).
 */
export const REQUIRED_IN_PRODUCTION = [
  'SMTP_HOST',
  'SMTP_PORT',
  'MAIL_FROM',
  'FRONTEND_BASE_URL',
  'JWT_SECRET',
  'IMAGE_BASE_URL',
] as const;

/**
 * Validates and types the raw environment. Throws when a variable is missing or invalid,
 * so the API does not start with a broken configuration. Error messages name the variable
 * and the rule, never the value, so secrets do not end up in logs.
 */
export function validateEnvironment(
  raw: Record<string, unknown>,
): EnvironmentVariables {
  const environment = plainToInstance(EnvironmentVariables, raw, {
    excludeExtraneousValues: true,
    exposeDefaultValues: true,
  });
  const problems = validateSync(environment).map(
    (error) => `- ${Object.values(error.constraints ?? {}).join('; ')}`,
  );
  problems.push(...auditArchiveProblems(environment));
  problems.push(...imageStorageProblems(environment));
  problems.push(...frontendLinkProblems(environment));
  if (environment.NODE_ENV === 'production') {
    for (const name of REQUIRED_IN_PRODUCTION) {
      if (raw[name] === undefined || raw[name] === '') {
        problems.push(`- ${name} is required when NODE_ENV is production`);
      }
    }
  }
  if (problems.length > 0) {
    throw new Error(`Invalid environment variables:\n${problems.join('\n')}`);
  }
  return environment;
}

/**
 * The audit archive stays private, out of the folder the API serves at /media, and keeps its files longer than the
 * database keeps the records (ADR-0146). An empty folder, or a number that is not one, already has its own problem.
 */
function auditArchiveProblems(environment: EnvironmentVariables): string[] {
  const problems: string[] = [];
  const { IMAGE_STORAGE_DIR: images, AUDIT_ARCHIVE_DIR: archive } = environment;
  if (
    images !== '' &&
    archive !== '' &&
    isSameOrInside(path.resolve(archive), path.resolve(images))
  ) {
    problems.push(
      '- AUDIT_ARCHIVE_DIR must not be IMAGE_STORAGE_DIR nor a folder inside it, which the API serves at /media',
    );
  }
  const {
    AUDIT_RETENTION_MONTHS: database,
    AUDIT_ARCHIVE_RETENTION_MONTHS: files,
  } = environment;
  // A number that is not one never compares, so it adds nothing to its own problem.
  if (files <= database) {
    problems.push(
      '- AUDIT_ARCHIVE_RETENTION_MONTHS must be more than AUDIT_RETENTION_MONTHS',
    );
  }
  return problems;
}

/**
 * The API serves the whole image folder at /media (ADR-0121), so it must never hold the application: the working
 * directory, where the code and `.env` live, cannot be the folder nor inside it (T-310). An empty folder already has
 * its own problem.
 */
function imageStorageProblems(environment: EnvironmentVariables): string[] {
  const images = environment.IMAGE_STORAGE_DIR;
  return images !== '' && isSameOrInside(process.cwd(), path.resolve(images))
    ? [
        '- IMAGE_STORAGE_DIR must not be the working directory nor a folder that contains it, because the API serves it at /media',
      ]
    : [];
}

/**
 * The links of the emails carry tokens (verification, recovery, access to guest orders), so production builds them
 * only with https (T-310, ADR-0154). A value that is no URL already has its own problem.
 */
function frontendLinkProblems(environment: EnvironmentVariables): string[] {
  return environment.NODE_ENV === 'production' &&
    /^http:/i.test(environment.FRONTEND_BASE_URL)
    ? [
        '- FRONTEND_BASE_URL must use https when NODE_ENV is production, because the links in emails carry tokens',
      ]
    : [];
}

/** Whether `folder` is `parent` or inside it. */
function isSameOrInside(folder: string, parent: string): boolean {
  const relative = path.relative(parent, folder);
  // The same folder is '', which neither goes up nor is absolute.
  return (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

/** `true` or `false` as text; anything else is left as is, so validation rejects it. */
function parseBoolean(value: unknown): unknown {
  if (value === undefined) return true;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

function parseCommaSeparatedList(value: unknown): unknown {
  if (value === undefined || value === null) {
    return [];
  }
  if (typeof value !== 'string') {
    return value;
  }
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/** An exact origin: `http` or `https` scheme, host and optional port; no path, wildcard or trailing slash. */
export function isExactOrigin(value: unknown): boolean {
  // The URL parser accepts "*" in host names (https://*.example.com), so wildcards are rejected explicitly.
  if (typeof value !== 'string' || value.includes('*')) {
    return false;
  }
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.origin === value
    );
  } catch {
    return false;
  }
}

function IsExactOrigin(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isExactOrigin',
      validator: {
        validate: isExactOrigin,
        defaultMessage: buildMessage(
          (eachPrefix) =>
            `${eachPrefix}$property must list exact origins such as https://shop.example.com (http or https, lowercase host, optional port; no "*", path or trailing slash)`,
          options,
        ),
      },
    },
    options,
  );
}

/** A PostgreSQL connection string: postgres or postgresql scheme with a host. */
export function isPostgresUrl(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'postgresql:' || url.protocol === 'postgres:') &&
      url.hostname.length > 0
    );
  } catch {
    return false;
  }
}

/**
 * A base URL, such as the frontend's or the images': `http` or `https`, host, optional port and path; no
 * query, fragment, credentials or trailing slash, so paths can be appended to it.
 */
export function isBaseUrl(value: unknown): boolean {
  if (
    typeof value !== 'string' ||
    value.endsWith('/') ||
    value.includes('?') ||
    value.includes('#')
  ) {
    return false;
  }
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.username === '' &&
      url.password === ''
    );
  } catch {
    return false;
  }
}

function IsBaseUrl(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isBaseUrl',
      validator: {
        validate: isBaseUrl,
        defaultMessage: buildMessage(
          () =>
            '$property must be an http or https URL such as https://shop.example.com or https://example.com/shop (no query, fragment, credentials or trailing slash)',
          options,
        ),
      },
    },
    options,
  );
}

/** A duration such as `15m` (s, m, h or d) between two bounds, in seconds. */
function IsDurationWithin(
  minSeconds: number,
  maxSeconds: number,
  range: string,
  options?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isDurationWithin',
      validator: {
        validate: (value: unknown) => {
          const seconds = durationSeconds(value);
          return (
            seconds !== undefined &&
            seconds >= minSeconds &&
            seconds <= maxSeconds
          );
        },
        defaultMessage: buildMessage(
          () =>
            `$property must be a duration such as 15m or 7d (s, m, h or d), ${range}`,
          options,
        ),
      },
    },
    options,
  );
}

function IsPostgresUrl(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isPostgresUrl',
      validator: {
        validate: isPostgresUrl,
        defaultMessage: buildMessage(
          () =>
            '$property must be a PostgreSQL connection string such as postgresql://user:password@localhost:5432/database',
          options,
        ),
      },
    },
    options,
  );
}
