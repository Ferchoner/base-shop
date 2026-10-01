import { Injectable } from '@nestjs/common';
import type { PermissionCode } from '../../../shared-kernel/index.js';
import type { AddressFields } from '../domain/address-book.js';
import { RoleRepository } from '../domain/role.repository.js';
import type { UserId } from '../domain/user.js';
import { UserRepository } from '../domain/user.repository.js';
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
 * Public, read-only operations of Identity & Access for the rest of the application (ADR-0005). Ordering
 * uses it for the checkout, so Identity can never use Ordering (ADR-0132).
 */
@Injectable()
export class IdentityAccessFacade {
  constructor(
    private readonly users: UserRepository,
    private readonly roles: RoleRepository,
    private readonly queries: IdentityQueries,
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

  /** The contact of an ACTIVE customer for an order; `null` for staff, other statuses and unknown ids. */
  async customerContact(userId: UserId): Promise<CustomerContact | null> {
    const account = await this.queries.findAccount(userId);
    return account?.type === 'CUSTOMER'
      ? { email: account.email, emailVerified: account.emailVerified }
      : null;
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
