import {
  Injectable,
  Logger,
  Module,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from './environment.js';

/** The variables of the retention policy (ADR-0149, ADR-0150). */
type RetentionVariables = Pick<
  EnvironmentVariables,
  | 'PERSONAL_DATA_RETENTION_ENABLED'
  | 'PERSONAL_DATA_OPERATIONAL_MONTHS'
  | 'PERSONAL_DATA_BLOCKED_MONTHS'
  | 'AUDIT_RETENTION_MONTHS'
  | 'AUDIT_ARCHIVE_RETENTION_MONTHS'
  | 'SPENT_REFRESH_TOKEN_RETENTION_DAYS'
  | 'INACTIVE_GUEST_CART_RETENTION_DAYS'
  | 'PROCESSED_WEBHOOK_EVENT_RETENTION_DAYS'
  | 'DELIVERED_EVENT_RETENTION_DAYS'
>;

/** The retention policy in force, in one line for the log; it holds no data, only periods. */
export function describeRetentionPolicy(env: RetentionVariables): string {
  const personalData = env.PERSONAL_DATA_RETENTION_ENABLED
    ? `blocked ${env.PERSONAL_DATA_OPERATIONAL_MONTHS} months after the order concludes and anonymized ${env.PERSONAL_DATA_BLOCKED_MONTHS} months later`
    : 'kept, since the retention cycle is disabled';
  return [
    `Retention policy (ADR-0149): personal data of orders ${personalData}`,
    `audit trail ${env.AUDIT_RETENTION_MONTHS} months in the database and ${env.AUDIT_ARCHIVE_RETENTION_MONTHS} in files`,
    `spent refresh tokens ${env.SPENT_REFRESH_TOKEN_RETENTION_DAYS} days`,
    `inactive guest carts ${env.INACTIVE_GUEST_CART_RETENTION_DAYS} days`,
    `processed webhook events ${env.PROCESSED_WEBHOOK_EVENT_RETENTION_DAYS} days`,
    `delivered domain events ${env.DELIVERED_EVENT_RETENTION_DAYS} days`,
  ].join('; ');
}

/** Logs the retention policy in force when the application starts, so an operator sees what applies (ADR-0149). */
@Injectable()
export class RetentionPolicyLog implements OnApplicationBootstrap {
  private readonly logger = new Logger('RetentionPolicy');

  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  onApplicationBootstrap(): void {
    const get = <Key extends keyof RetentionVariables>(key: Key) =>
      this.config.get(key, { infer: true }) as RetentionVariables[Key];
    this.logger.log(
      describeRetentionPolicy({
        PERSONAL_DATA_RETENTION_ENABLED: get('PERSONAL_DATA_RETENTION_ENABLED'),
        PERSONAL_DATA_OPERATIONAL_MONTHS: get(
          'PERSONAL_DATA_OPERATIONAL_MONTHS',
        ),
        PERSONAL_DATA_BLOCKED_MONTHS: get('PERSONAL_DATA_BLOCKED_MONTHS'),
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
      }),
    );
  }
}

/** The log of the retention policy at startup (ADR-0149). */
@Module({ providers: [RetentionPolicyLog] })
export class RetentionPolicyModule {}
