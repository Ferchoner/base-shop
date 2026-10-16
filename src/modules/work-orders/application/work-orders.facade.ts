import { Injectable } from '@nestjs/common';
import { toId } from '../../../shared-kernel/index.js';
import { WorkOrderAnonymizations } from './work-order-anonymizations.js';

/**
 * Public API of Work Orders (ADR-0005): for the anonymization of a customer, which Privacy runs across modules in one
 * transaction (ADR-0145, ADR-0167). Work Orders never uses Privacy.
 */
@Injectable()
export class WorkOrdersFacade {
  constructor(private readonly anonymizations: WorkOrderAnonymizations) {}

  /**
   * Anonymizes every work order linked to the customer, all or none, in the transaction of the caller, each audited
   * as `work-orders.anonymize` with the reason.
   *
   * @returns how many work orders it anonymized.
   * @throws OpenWorkOrdersError (E-31) when one was neither delivered nor cancelled.
   */
  anonymizeCustomerWorkOrders(input: {
    customerId: string;
    reason: string;
    at: Date;
  }): Promise<number> {
    return this.anonymizations.ofCustomer({
      customerId: toId<'User'>(input.customerId),
      reason: input.reason,
      at: input.at,
    });
  }
}
