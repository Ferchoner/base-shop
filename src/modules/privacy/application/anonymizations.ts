import { Injectable } from '@nestjs/common';
import { Clock, TransactionManager } from '../../../shared-kernel/index.js';
import {
  BuyerOrders,
  CustomerAccounts,
  CustomerCarts,
  CustomerWorkOrders,
} from './anonymization-ports.js';

/** What anonymizing a customer did (API_SPEC.md §9.18). */
export interface CustomerAnonymization {
  readonly userId: string;
  readonly anonymizedAt: Date;
  readonly anonymizedOrderCount: number;
  /** Work orders linked to the customer that were anonymized (ADR-0167). */
  readonly anonymizedWorkOrderCount: number;
}

/**
 * The anonymizations of customers and guest buyers (UC-IAM-19, ADR-0067), which the staff runs for a request
 * received outside the system (BR-PRIV-02). Each one is all or nothing, in one transaction across Identity & Access,
 * Ordering, Work Orders and Shopping (ADR-0145, ADR-0167), with the same date everywhere. The reason is the reference of the request, and
 * every module audits its own changes with it, without the values (BR-PRIV-04).
 */
@Injectable()
export class Anonymizations {
  constructor(
    private readonly accounts: CustomerAccounts,
    private readonly orders: BuyerOrders,
    private readonly workOrders: CustomerWorkOrders,
    private readonly carts: CustomerCarts,
    private readonly transactions: TransactionManager,
    private readonly clock: Clock,
  ) {}

  /**
   * Anonymizes a customer: their account, with their sessions, links and addresses; their orders and shipments; the
   * work orders linked to them; and their carts. Checks, in this order: that the ID is a customer's, the version, that
   * the customer was not anonymized, that every order of theirs concluded, and that every work order was delivered or
   * cancelled.
   *
   * @throws NotFoundError; VersionConflictError; InvalidStateTransitionError; ActiveOrdersExistError;
   *   OpenWorkOrdersError, which answers the same `active-orders-exist`.
   */
  customer(input: {
    actorId: string;
    userId: string;
    reason: string;
    version: number;
  }): Promise<CustomerAnonymization> {
    return this.transactions.run(async () => {
      const at = this.clock.now();
      await this.accounts.anonymize({
        actorId: input.actorId,
        customerId: input.userId,
        reason: input.reason,
        version: input.version,
        at,
      });
      const anonymizedOrderCount = await this.orders.anonymize({
        buyer: { customerId: input.userId },
        reason: input.reason,
        at,
      });
      const anonymizedWorkOrderCount = await this.workOrders.anonymize({
        customerId: input.userId,
        reason: input.reason,
        at,
      });
      await this.carts.deleteOf(input.userId);
      return {
        userId: input.userId,
        anonymizedAt: at,
        anonymizedOrderCount,
        anonymizedWorkOrderCount,
      };
    });
  }

  /**
   * Anonymizes every guest order with the email, and their shipments, for a guest who shows the code of one of them.
   * Their guest carts go with the daily cleanup (BR-CRT-06).
   *
   * @returns how many orders it anonymized.
   * @throws NotFoundError when no guest order has the code and the email; ActiveOrdersExistError.
   */
  guest(input: {
    contactEmail: string;
    publicCode: string;
    reason: string;
  }): Promise<number> {
    return this.transactions.run(() =>
      this.orders.anonymize({
        buyer: {
          contactEmail: input.contactEmail,
          publicCode: input.publicCode,
        },
        reason: input.reason,
        at: this.clock.now(),
      }),
    );
  }
}
