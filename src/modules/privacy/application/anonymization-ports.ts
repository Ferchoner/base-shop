// Privacy's application layer cannot import other modules (ADR-0103): these ports say what an anonymization needs of
// each module, and adapters in its infrastructure answer them with their facades (ADR-0145). Every operation joins
// the transaction of the caller. Abstract classes rather than interfaces, so they can be the dependency injection
// tokens without depending on NestJS.

/** The account of a customer, in Identity & Access. */
export abstract class CustomerAccounts {
  /**
   * Anonymizes the account (UC-IAM-19), audited as `customers.anonymize`.
   *
   * @throws NotFoundError for an ID that is not a customer's; VersionConflictError; InvalidStateTransitionError when
   *   the customer was already anonymized.
   */
  abstract anonymize(input: {
    actorId: string;
    customerId: string;
    reason: string;
    version: number;
    at: Date;
  }): Promise<void>;

  /**
   * Up to `limit` customers without activity since `before`, the least recently active first (ADR-0152); not
   * locked.
   */
  abstract inactiveSince(before: Date, limit: number): Promise<string[]>;

  /**
   * Anonymizes the account of a customer still without activity since `inactiveSince`, locked and looked at again,
   * audited as `customers.anonymize` by the system (ADR-0152).
   *
   * @returns whether it anonymized it: false for one that is not a customer's, anonymized or active meanwhile.
   */
  abstract anonymizeIfInactive(input: {
    customerId: string;
    inactiveSince: Date;
    reason: string;
    at: Date;
  }): Promise<boolean>;
}

/** Whose orders: a customer's, or a guest's, who shows the email and the public code of one of them. */
export type Buyer =
  | { readonly customerId: string }
  | { readonly contactEmail: string; readonly publicCode: string };

/** The orders of a buyer and their shipments, in Ordering. */
export abstract class BuyerOrders {
  /**
   * Anonymizes every order of the buyer and their shipments, all or none, each audited as `orders.anonymize`.
   *
   * @returns how many orders it anonymized.
   * @throws NotFoundError for a guest when no guest order has the code and the email; ActiveOrdersExistError when an
   *   order has not concluded.
   */
  abstract anonymize(input: {
    buyer: Buyer;
    reason: string;
    at: Date;
  }): Promise<number>;

  /** Whether the customer has an order that has not concluded: one on its way, or with its refund pending. */
  abstract hasOpenOrders(customerId: string): Promise<boolean>;
}

/** The carts of a customer, in Shopping. */
export abstract class CustomerCarts {
  /** Deletes every cart of the customer, with the guest carts merged into them. */
  abstract deleteOf(customerId: string): Promise<void>;
}
