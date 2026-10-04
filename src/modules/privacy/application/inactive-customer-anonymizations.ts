import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  Clock,
  monthsBefore,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import {
  BuyerOrders,
  CustomerAccounts,
  CustomerCarts,
} from './anonymization-ports.js';

/**
 * Months without activity after which the account of a customer is anonymized, or `null` to never do it:
 * `INACTIVE_CUSTOMER_ANONYMIZATION_MONTHS`, unset by default (ADR-0149, ADR-0152).
 */
export const INACTIVE_CUSTOMER_ANONYMIZATION_MONTHS = Symbol(
  'INACTIVE_CUSTOMER_ANONYMIZATION_MONTHS',
);

/**
 * Customers one run anonymizes at most: the rest wait for the next day, so a period shortened by mistake can be fixed
 * before every account is anonymized (ADR-0144, ADR-0152).
 */
export const INACTIVE_BATCH_SIZE = 1_000;

/** The reason of an anonymization for inactivity, in the audit trail. */
export const INACTIVITY_REASON =
  'Cuenta sin actividad durante el plazo de conservación (ADR-0149)';

/** What one run did. */
export interface InactivityRun {
  readonly anonymized: number;
  /** Customers with an order that has not concluded: they are looked at again the next day. */
  readonly skipped: number;
  /** Customers whose anonymization failed; the log tells why, and the next run tries them again. */
  readonly failed: number;
}

/** An inactive customer with an order that has not concluded, whose anonymization is undone. */
class OpenOrdersError extends Error {}

/**
 * The anonymization of the accounts of inactive customers (ADR-0149, ADR-0152), run every day when
 * `INACTIVE_CUSTOMER_ANONYMIZATION_MONTHS` is set. Activity is signing up, signing in or renewing the session.
 *
 * Only the account goes, as UC-IAM-19 does it: its data, sessions, links, addresses and carts. Its orders stay, and
 * follow their own retention cycle (ADR-0070), because the blocked phase keeps them for claims and obligations. A
 * customer with an order that has not concluded is skipped, as an anonymization by request would refuse (E-31).
 *
 * Each customer goes in its own transaction, locked and looked at again; one that fails goes to the log, and the
 * others go on.
 */
@Injectable()
export class InactiveCustomerAnonymizations {
  private readonly logger = new Logger(InactiveCustomerAnonymizations.name);

  constructor(
    private readonly accounts: CustomerAccounts,
    private readonly orders: BuyerOrders,
    private readonly carts: CustomerCarts,
    private readonly transactions: TransactionManager,
    private readonly clock: Clock,
    @Inject(INACTIVE_CUSTOMER_ANONYMIZATION_MONTHS)
    private readonly months: number | null,
  ) {}

  async run(): Promise<InactivityRun> {
    if (this.months === null) {
      this.logger.log('Anonymization of inactive customers is disabled');
      return { anonymized: 0, skipped: 0, failed: 0 };
    }
    const now = this.clock.now();
    const before = monthsBefore(now, this.months);
    let anonymized = 0;
    let skipped = 0;
    let failed = 0;
    for (const customerId of await this.accounts.inactiveSince(
      before,
      INACTIVE_BATCH_SIZE,
    )) {
      try {
        if (await this.anonymize(customerId, before, now)) anonymized += 1;
      } catch (error) {
        if (error instanceof OpenOrdersError) {
          skipped += 1;
          continue;
        }
        failed += 1;
        this.logger.error(
          `Could not anonymize inactive customer ${customerId}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
    this.logger.log(
      `Inactive customers: ${anonymized} anonymized, ${skipped} skipped with orders that have not concluded, ${failed} failed`,
    );
    return { anonymized, skipped, failed };
  }

  /** @throws OpenOrdersError, after the account is locked, so a checkout that was placing an order counts. */
  private anonymize(
    customerId: string,
    before: Date,
    now: Date,
  ): Promise<boolean> {
    return this.transactions.run(async () => {
      const done = await this.accounts.anonymizeIfInactive({
        customerId,
        inactiveSince: before,
        reason: INACTIVITY_REASON,
        at: now,
      });
      if (!done) return false;
      if (await this.orders.hasOpenOrders(customerId)) {
        throw new OpenOrdersError();
      }
      await this.carts.deleteOf(customerId);
      return true;
    });
  }
}
