// class-transformer's @Type reads decorator metadata; load the polyfill here so this module works on its own.
import 'reflect-metadata';
import { Expose, plainToInstance, Transform, Type } from 'class-transformer';
import {
  buildMessage,
  IsBoolean,
  IsIn,
  IsInt,
  Matches,
  Max,
  Min,
  ValidateBy,
  validateSync,
  type ValidationError,
  type ValidationOptions,
} from 'class-validator';
import { RATE_LIMIT_PATTERN } from './rate-limit-value.js';

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
}

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
  const errors = validateSync(environment);
  if (errors.length > 0) {
    throw new Error(`Invalid environment variables:\n${formatErrors(errors)}`);
  }
  return environment;
}

function formatErrors(errors: ValidationError[]): string {
  return errors
    .map((error) => `- ${Object.values(error.constraints ?? {}).join('; ')}`)
    .join('\n');
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
