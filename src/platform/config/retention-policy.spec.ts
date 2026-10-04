import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from './environment.js';
import {
  describeRetentionPolicy,
  RetentionPolicyLog,
  RetentionPolicyReader,
  retentionPolicyOf,
} from './retention-policy.js';

const POLICY = {
  PERSONAL_DATA_RETENTION_ENABLED: true,
  PERSONAL_DATA_OPERATIONAL_MONTHS: 12,
  PERSONAL_DATA_BLOCKED_MONTHS: 60,
  AUDIT_RETENTION_MONTHS: 3,
  AUDIT_ARCHIVE_RETENTION_MONTHS: 24,
  SPENT_REFRESH_TOKEN_RETENTION_DAYS: 30,
  INACTIVE_GUEST_CART_RETENTION_DAYS: 14,
  PROCESSED_WEBHOOK_EVENT_RETENTION_DAYS: 45,
  DELIVERED_EVENT_RETENTION_DAYS: 7,
};

describe('Retention policy (ADR-0149)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('describes every period in force, in one line', () => {
    expect(describeRetentionPolicy(POLICY)).toBe(
      'Retention policy (ADR-0149): personal data of orders blocked 12 months after the order concludes and anonymized 60 months later; ' +
        'accounts of inactive customers never anonymized; audit trail 3 months in the database and 24 in files; spent refresh tokens 30 days; inactive guest carts 14 days; ' +
        'processed webhook events 45 days; delivered domain events 7 days',
    );
  });

  it('says the personal data is kept while the cycle is disabled', () => {
    expect(
      describeRetentionPolicy({
        ...POLICY,
        PERSONAL_DATA_RETENTION_ENABLED: false,
      }),
    ).toMatch(
      /^Retention policy \(ADR-0149\): personal data of orders kept, since the retention cycle is disabled; accounts of inactive customers never anonymized; audit trail 3 months/,
    );
  });

  it('says after how many months without activity the accounts of customers are anonymized, when set (ADR-0152)', () => {
    expect(
      describeRetentionPolicy({
        ...POLICY,
        INACTIVE_CUSTOMER_ANONYMIZATION_MONTHS: 36,
      }),
    ).toContain(
      '; accounts of inactive customers anonymized after 36 months without activity; ',
    );
  });

  it('gives the periods that keep personal data, without the domain events, which carry none (ADR-0152)', () => {
    expect(retentionPolicyOf(POLICY)).toEqual({
      personalData: { enabled: true, operationalMonths: 12, blockedMonths: 60 },
      inactiveCustomerMonths: null,
      auditTrail: { databaseMonths: 3, archiveMonths: 24 },
      spentRefreshTokenDays: 30,
      inactiveGuestCartDays: 14,
      processedWebhookEventDays: 45,
    });
    expect(
      retentionPolicyOf({
        ...POLICY,
        INACTIVE_CUSTOMER_ANONYMIZATION_MONTHS: 36,
      }).inactiveCustomerMonths,
    ).toBe(36);
  });

  it('reads the policy from the configuration', () => {
    const config = {
      get: (key: keyof typeof POLICY) => POLICY[key],
    } as unknown as ConfigService<EnvironmentVariables, true>;

    expect(new RetentionPolicyReader(config).policy()).toEqual(
      retentionPolicyOf(POLICY),
    );
  });

  it('logs the policy of the configuration when the application starts', () => {
    const log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => {});
    const config = {
      get: (key: keyof typeof POLICY) => POLICY[key],
    } as unknown as ConfigService<EnvironmentVariables, true>;

    new RetentionPolicyLog(
      new RetentionPolicyReader(config),
    ).onApplicationBootstrap();

    expect(log).toHaveBeenCalledWith(describeRetentionPolicy(POLICY));
  });
});
