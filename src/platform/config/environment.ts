// class-transformer's @Type reads decorator metadata; load the polyfill here so this module works on its own.
import 'reflect-metadata';
import { Expose, plainToInstance, Transform, Type } from 'class-transformer';
import {
  buildMessage,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  Matches,
  Max,
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

  /** Addresses a customer can keep (BR-ADR-04, ADR-0057, ADR-0113). */
  @Expose()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  MAX_ADDRESSES_PER_CUSTOMER: number = 10;

  /** Requests per IP on every endpoint without a specific limit. Format `<count>/<duration>` (ADR-0065, ADR-0102). */
  @Expose()
  @Matches(RATE_LIMIT_PATTERN, {
    message: '$property must look like 5/15m (count / duration in s, m or h)',
  })
  RATE_LIMIT_DEFAULT: string = '100/1m';

  /** Failed logins per email. Format `<count>/<duration>` (ADR-0065, ADR-0102). */
  @Expose()
  @Matches(RATE_LIMIT_PATTERN, {
    message: '$property must look like 5/15m (count / duration in s, m or h)',
  })
  RATE_LIMIT_LOGIN_EMAIL: string = '5/15m';

  /** Failed logins per IP. Format `<count>/<duration>` (ADR-0065, ADR-0102). */
  @Expose()
  @Matches(RATE_LIMIT_PATTERN, {
    message: '$property must look like 5/15m (count / duration in s, m or h)',
  })
  RATE_LIMIT_LOGIN_IP: string = '20/15m';

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

  /** Guest order lookups and reorders per IP. Format `<count>/<duration>` (ADR-0065, ADR-0102). */
  @Expose()
  @Matches(RATE_LIMIT_PATTERN, {
    message: '$property must look like 5/15m (count / duration in s, m or h)',
  })
  RATE_LIMIT_GUEST_ORDER: string = '10/15m';

  /** Orders placed per user or cart. Format `<count>/<duration>` (ADR-0065, ADR-0102). */
  @Expose()
  @Matches(RATE_LIMIT_PATTERN, {
    message: '$property must look like 5/15m (count / duration in s, m or h)',
  })
  RATE_LIMIT_PLACE_ORDER: string = '10/10m';

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

  /** Base URL of the frontend for the links in emails (ADR-0056, ADR-0110). Required in production. */
  @Expose()
  @IsFrontendBaseUrl()
  FRONTEND_BASE_URL: string = 'http://localhost:5173';

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
}

/**
 * Variables that production must set explicitly. With the development defaults, emails would go nowhere and
 * their links would point to localhost (ADR-0110), and access tokens would be signed with a key that changes
 * on every restart (ADR-0114).
 */
export const REQUIRED_IN_PRODUCTION = [
  'SMTP_HOST',
  'SMTP_PORT',
  'MAIL_FROM',
  'FRONTEND_BASE_URL',
  'JWT_SECRET',
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
 * The frontend base URL: `http` or `https`, host, optional port and path; no query, fragment, credentials
 * or trailing slash, so page paths can be appended to it.
 */
export function isFrontendBaseUrl(value: unknown): boolean {
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

function IsFrontendBaseUrl(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isFrontendBaseUrl',
      validator: {
        validate: isFrontendBaseUrl,
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
