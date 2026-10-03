import { Injectable } from '@nestjs/common';
import { toId } from '../../../shared-kernel/index.js';
import { IdentityAccessFacade } from '../../identity-access/index.js';
import { OrderingFacade } from '../../ordering/index.js';
import { ShoppingFacade } from '../../shopping/index.js';
import {
  type Buyer,
  BuyerOrders,
  CustomerAccounts,
  CustomerCarts,
} from '../application/anonymization-ports.js';

// Privacy's ports answered with the facades of the modules that own the data (ADR-0005, ADR-0145). No module uses
// Privacy, so they never form a cycle.

@Injectable()
export class IdentityFacadeCustomerAccounts extends CustomerAccounts {
  constructor(private readonly identity: IdentityAccessFacade) {
    super();
  }

  anonymize(input: {
    actorId: string;
    customerId: string;
    reason: string;
    version: number;
    at: Date;
  }): Promise<void> {
    return this.identity.anonymizeCustomer({
      actorId: toId<'User'>(input.actorId),
      userId: toId<'User'>(input.customerId),
      reason: input.reason,
      version: input.version,
      at: input.at,
    });
  }

  inactiveSince(before: Date, limit: number): Promise<string[]> {
    return this.identity.inactiveCustomers(before, limit);
  }

  anonymizeIfInactive(input: {
    customerId: string;
    inactiveSince: Date;
    reason: string;
    at: Date;
  }): Promise<boolean> {
    return this.identity.anonymizeInactiveCustomer({
      userId: toId<'User'>(input.customerId),
      inactiveSince: input.inactiveSince,
      reason: input.reason,
      at: input.at,
    });
  }
}

@Injectable()
export class OrderingFacadeBuyerOrders extends BuyerOrders {
  constructor(private readonly ordering: OrderingFacade) {
    super();
  }

  anonymize(input: {
    buyer: Buyer;
    reason: string;
    at: Date;
  }): Promise<number> {
    const { buyer } = input;
    return this.ordering.anonymizeOrders({
      buyer:
        'customerId' in buyer
          ? { customerId: toId<'User'>(buyer.customerId) }
          : { contactEmail: buyer.contactEmail, publicCode: buyer.publicCode },
      reason: input.reason,
      at: input.at,
    });
  }

  hasOpenOrders(customerId: string): Promise<boolean> {
    return this.ordering.hasOpenOrders(customerId);
  }
}

@Injectable()
export class ShoppingFacadeCustomerCarts extends CustomerCarts {
  constructor(private readonly shopping: ShoppingFacade) {
    super();
  }

  deleteOf(customerId: string): Promise<void> {
    return this.shopping.deleteCartsOf(toId<'User'>(customerId));
  }
}
