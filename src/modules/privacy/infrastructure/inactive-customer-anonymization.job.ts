import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { ScheduledJob } from '../../../platform/jobs/scheduled-job.decorator.js';
import { InactiveCustomerAnonymizations } from '../application/inactive-customer-anonymizations.js';

/**
 * Every day at 3:00, Mexico time, the accounts of the customers without activity for
 * `INACTIVE_CUSTOMER_ANONYMIZATION_MONTHS` are anonymized, when it is set (ADR-0149, ADR-0152).
 */
@Injectable()
export class InactiveCustomerAnonymizationJob {
  constructor(
    private readonly anonymizations: InactiveCustomerAnonymizations,
  ) {}

  @ScheduledJob(
    'privacy.anonymize-inactive-customers',
    CronExpression.EVERY_DAY_AT_3AM,
  )
  async run(): Promise<void> {
    await this.anonymizations.run();
  }
}
