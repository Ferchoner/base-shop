import {
  Injectable,
  Logger,
  Module,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from './environment.js';

/** The variables of the retention policy (ADR-0149, ADR-0150, ADR-0151, ADR-0152). */
type RetentionVariables = Pick<
  EnvironmentVariables,
  | 'PERSONAL_DATA_RETENTION_ENABLED'
  | 'PERSONAL_DATA_OPERATIONAL_MONTHS'
  | 'PERSONAL_DATA_BLOCKED_MONTHS'
  | 'INACTIVE_CUSTOMER_ANONYMIZATION_MONTHS'
  | 'AUDIT_RETENTION_MONTHS'
  | 'AUDIT_ARCHIVE_RETENTION_MONTHS'
  | 'SPENT_REFRESH_TOKEN_RETENTION_DAYS'
  | 'INACTIVE_GUEST_CART_RETENTION_DAYS'
  | 'PROCESSED_WEBHOOK_EVENT_RETENTION_DAYS'
  | 'DELIVERED_EVENT_RETENTION_DAYS'
>;

/**
 * The periods in force that keep or delete personal data (ADR-0149, ADR-0152), as the public route publishes them for
 * the privacy notice. The domain events are left out: they carry no personal data (ADR-0150).
 */
export interface RetentionPolicy {
  readonly personalData: {
    readonly enabled: boolean;
    readonly operationalMonths: number;
    readonly blockedMonths: number;
  };
  /** `null` while the accounts of inactive customers are never anonymized. */
  readonly inactiveCustomerMonths: number | null;
  readonly auditTrail: {
    readonly databaseMonths: number;
    readonly archiveMonths: number;
  };
  readonly spentRefreshTokenDays: number;
  readonly inactiveGuestCartDays: number;
  readonly processedWebhookEventDays: number;
}

export function retentionPolicyOf(env: RetentionVariables): RetentionPolicy {
  return {
    personalData: {
      enabled: env.PERSONAL_DATA_RETENTION_ENABLED,
      operationalMonths: env.PERSONAL_DATA_OPERATIONAL_MONTHS,
      blockedMonths: env.PERSONAL_DATA_BLOCKED_MONTHS,
    },
    inactiveCustomerMonths: env.INACTIVE_CUSTOMER_ANONYMIZATION_MONTHS ?? null,
    auditTrail: {
      databaseMonths: env.AUDIT_RETENTION_MONTHS,
      archiveMonths: env.AUDIT_ARCHIVE_RETENTION_MONTHS,
    },
    spentRefreshTokenDays: env.SPENT_REFRESH_TOKEN_RETENTION_DAYS,
    inactiveGuestCartDays: env.INACTIVE_GUEST_CART_RETENTION_DAYS,
    processedWebhookEventDays: env.PROCESSED_WEBHOOK_EVENT_RETENTION_DAYS,
  };
}

/** The retention policy in force, in one line for the log; it holds no data, only periods. */
export function describeRetentionPolicy(env: RetentionVariables): string {
  const personalData = env.PERSONAL_DATA_RETENTION_ENABLED
    ? `blocked ${env.PERSONAL_DATA_OPERATIONAL_MONTHS} months after the order concludes and anonymized ${env.PERSONAL_DATA_BLOCKED_MONTHS} months later`
    : 'kept, since the retention cycle is disabled';
  const inactiveCustomers =
    env.INACTIVE_CUSTOMER_ANONYMIZATION_MONTHS === undefined
      ? 'never anonymized'
      : `anonymized after ${env.INACTIVE_CUSTOMER_ANONYMIZATION_MONTHS} months without activity`;
  return [
    `Retention policy (ADR-0149): personal data of orders ${personalData}`,
    `accounts of inactive customers ${inactiveCustomers}`,
    `audit trail ${env.AUDIT_RETENTION_MONTHS} months in the database and ${env.AUDIT_ARCHIVE_RETENTION_MONTHS} in files`,
    `spent refresh tokens ${env.SPENT_REFRESH_TOKEN_RETENTION_DAYS} days`,
    `inactive guest carts ${env.INACTIVE_GUEST_CART_RETENTION_DAYS} days`,
    `processed webhook events ${env.PROCESSED_WEBHOOK_EVENT_RETENTION_DAYS} days`,
    `delivered domain events ${env.DELIVERED_EVENT_RETENTION_DAYS} days`,
  ].join('; ');
}

/** Reads the variables of the retention policy from the configuration (ADR-0149, ADR-0152). */
@Injectable()
export class RetentionPolicyReader {
  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  variables(): RetentionVariables {
    const get = <Key extends keyof RetentionVariables>(key: Key) =>
      this.config.get(key, { infer: true }) as RetentionVariables[Key];
    return {
      PERSONAL_DATA_RETENTION_ENABLED: get('PERSONAL_DATA_RETENTION_ENABLED'),
      PERSONAL_DATA_OPERATIONAL_MONTHS: get('PERSONAL_DATA_OPERATIONAL_MONTHS'),
      PERSONAL_DATA_BLOCKED_MONTHS: get('PERSONAL_DATA_BLOCKED_MONTHS'),
      INACTIVE_CUSTOMER_ANONYMIZATION_MONTHS: get(
        'INACTIVE_CUSTOMER_ANONYMIZATION_MONTHS',
      ),
      AUDIT_RETENTION_MONTHS: get('AUDIT_RETENTION_MONTHS'),
      AUDIT_ARCHIVE_RETENTION_MONTHS: get('AUDIT_ARCHIVE_RETENTION_MONTHS'),
      SPENT_REFRESH_TOKEN_RETENTION_DAYS: get(
        'SPENT_REFRESH_TOKEN_RETENTION_DAYS',
      ),
      INACTIVE_GUEST_CART_RETENTION_DAYS: get(
        'INACTIVE_GUEST_CART_RETENTION_DAYS',
      ),
      PROCESSED_WEBHOOK_EVENT_RETENTION_DAYS: get(
        'PROCESSED_WEBHOOK_EVENT_RETENTION_DAYS',
      ),
      DELIVERED_EVENT_RETENTION_DAYS: get('DELIVERED_EVENT_RETENTION_DAYS'),
    };
  }

  /** The periods in force that keep or delete personal data. */
  policy(): RetentionPolicy {
    return retentionPolicyOf(this.variables());
  }
}

/** Logs the retention policy in force when the application starts, so an operator sees what applies (ADR-0149). */
@Injectable()
export class RetentionPolicyLog implements OnApplicationBootstrap {
  private readonly logger = new Logger('RetentionPolicy');

  constructor(private readonly reader: RetentionPolicyReader) {}

  onApplicationBootstrap(): void {
    this.logger.log(describeRetentionPolicy(this.reader.variables()));
  }
}

/** The retention policy: its reader, which Privacy publishes (ADR-0152), and its log at startup (ADR-0149). */
@Module({
  providers: [RetentionPolicyReader, RetentionPolicyLog],
  exports: [RetentionPolicyReader],
})
export class RetentionPolicyModule {}
