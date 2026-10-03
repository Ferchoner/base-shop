import { Injectable } from '@nestjs/common';
import type { PermissionCode } from '../../../shared-kernel/index.js';
import type { AddressFields } from '../domain/address-book.js';
import { RoleRepository } from '../domain/role.repository.js';
import type { UserId } from '../domain/user.js';
import { UserRepository } from '../domain/user.repository.js';
import { AnonymizeCustomer } from './anonymize-customer.use-case.js';
import { effectivePermissions } from './effective-permissions.js';
import { IdentityQueries } from './identity.queries.js';

/** How an order reaches a customer (UC-ORD-02): the account email, and whether it is verified (BR-USR-05). */
export interface CustomerContact {
  readonly email: string;
  readonly emailVerified: boolean;
}

/** A saved address with the names of its state and municipality, as an order keeps it (ADR-0057). */
export interface CustomerAddress extends AddressFields {
  readonly stateName: string;
  readonly municipalityName: string;
}

/**
 * Public operations of Identity & Access for the rest of the application (ADR-0005). Ordering uses it for the
 * checkout, and Privacy to anonymize customers, so Identity can never use either (ADR-0132, ADR-0145).
 */
@Injectable()
export class IdentityAccessFacade {
  constructor(
    private readonly users: UserRepository,
    private readonly roles: RoleRepository,
    private readonly queries: IdentityQueries,
    private readonly anonymization: AnonymizeCustomer,
  ) {}

  /**
   * The permissions of an ACTIVE staff member: the union of the permissions of their roles, every permission
   * with the superadmin role (ADR-0111). Customers, suspended accounts and unknown ids have none.
   * Authentication reads them on every request (ADR-0114).
   */
  async permissionsOf(userId: UserId): Promise<PermissionCode[]> {
    const user = await this.users.findById(userId);
    return user === null ? [] : effectivePermissions(user, this.roles);
  }

  /**
   * The contact of an ACTIVE customer for an order; `null` for staff, other statuses and unknown ids. The account
   * stays locked for share until the transaction of the checkout ends, so an anonymization waits for the order, or
   * the order finds the customer anonymized (ADR-0145).
   */
  customerContact(userId: UserId): Promise<CustomerContact | null> {
    return this.queries.lockCustomerContact(userId);
  }

  /**
   * Anonymizes the account of a customer (UC-IAM-19, ADR-0067), in the transaction of the caller: Privacy
   * anonymizes their orders and deletes their carts in the same one (ADR-0145).
   *
   * @throws NotFoundError for an ID that is not a customer's; VersionConflictError; InvalidStateTransitionError when
   *   the customer was already anonymized.
   */
  anonymizeCustomer(input: {
    actorId: UserId;
    userId: UserId;
    reason: string;
    version: number;
    at: Date;
  }): Promise<void> {
    return this.anonymization.execute(input);
  }

  /** One of the customer's saved addresses (UC-IAM-11); `null` when it does not exist or is another's. */
  async customerAddress(
    customerId: UserId,
    addressId: string,
  ): Promise<CustomerAddress | null> {
    const address = await this.queries.findAddress(customerId, addressId);
    if (address === null) return null;
    return {
      recipientName: address.recipientName,
      phone: address.phone,
      street: address.street,
      exteriorNumber: address.exteriorNumber,
      interiorNumber: address.interiorNumber,
      neighborhood: address.neighborhood,
      postalCode: address.postalCode,
      stateCode: address.stateCode,
      stateName: address.stateName,
      municipalityCode: address.municipalityCode,
      municipalityName: address.municipalityName,
      city: address.city,
      references: address.references,
    };
  }
}
