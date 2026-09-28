import type {
  Page,
  PageRequest,
  PermissionCode,
  SortOrder,
} from '../../../shared-kernel/index.js';
import type { RoleId } from '../domain/role.js';
import type { UserId, UserStatus } from '../domain/user.js';

export interface RoleView {
  readonly id: RoleId;
  readonly name: string;
  readonly description: string | null;
  readonly isSuperadmin: boolean;
  /** Every permission of the catalog for the superadmin role. */
  readonly permissions: readonly PermissionCode[];
  readonly userCount: number;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface StaffView {
  readonly id: UserId;
  readonly email: string;
  readonly firstNames: string;
  readonly lastNames: string;
  readonly status: UserStatus;
  readonly mustChangePassword: boolean;
  readonly roles: readonly { readonly id: RoleId; readonly name: string }[];
  readonly lastLoginAt: Date | null;
  readonly version: number;
  readonly createdAt: Date;
}

export interface CustomerView {
  readonly id: UserId;
  /** `null` once anonymized (ADR-0067). */
  readonly email: string | null;
  readonly firstNames: string | null;
  readonly lastNames: string | null;
  readonly status: UserStatus;
  readonly emailVerified: boolean;
  readonly createdAt: Date;
  readonly lastLoginAt: Date | null;
  readonly anonymizedAt: Date | null;
  readonly version: number;
}

export interface AddressView {
  readonly id: string;
  readonly recipientName: string;
  readonly phone: string;
  readonly street: string;
  readonly exteriorNumber: string;
  readonly interiorNumber: string | null;
  readonly neighborhood: string;
  readonly postalCode: string;
  readonly stateCode: string;
  readonly stateName: string;
  readonly municipalityCode: string;
  readonly municipalityName: string;
  readonly city: string | null;
  readonly references: string | null;
  readonly isDefault: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CustomerDetailView extends CustomerView {
  /** The default address first, then the newest (API_SPEC.md §9.14). */
  readonly addresses: readonly AddressView[];
  /** 0 until T-180 connects Ordering (ADR-0111). */
  readonly orderCount: number;
}

export type RoleSortField = 'name' | 'createdAt';
export type StaffSortField = 'createdAt' | 'email';
export type CustomerSortField = 'createdAt' | 'email' | 'lastLoginAt';

export interface RoleFilter {
  /** Part of the name, ignoring case. */
  readonly q?: string;
}

export interface StaffFilter {
  /** Part of the email or of the names, ignoring case. */
  readonly q?: string;
  readonly status?: readonly UserStatus[];
  readonly roleId?: RoleId;
}

export interface CustomerFilter {
  /** Part of the email or of the names, ignoring case. */
  readonly q?: string;
  readonly status?: readonly UserStatus[];
  readonly emailVerified?: boolean;
  /** Both ends included. */
  readonly createdFrom?: Date;
  readonly createdTo?: Date;
}

/**
 * Read-only views of Identity & Access for the administrative endpoints (UC-IAM-14 to 18). They read the
 * database directly instead of loading aggregates. An abstract class rather than an interface, so it can be
 * the dependency injection token without depending on NestJS.
 */
export abstract class IdentityQueries {
  abstract listRoles(
    filter: RoleFilter,
    sort: readonly SortOrder<RoleSortField>[],
    page: PageRequest,
  ): Promise<Page<RoleView>>;

  abstract findRole(id: RoleId): Promise<RoleView | null>;

  abstract listStaff(
    filter: StaffFilter,
    sort: readonly SortOrder<StaffSortField>[],
    page: PageRequest,
  ): Promise<Page<StaffView>>;

  abstract findStaff(id: UserId): Promise<StaffView | null>;

  abstract listCustomers(
    filter: CustomerFilter,
    sort: readonly SortOrder<CustomerSortField>[],
    page: PageRequest,
  ): Promise<Page<CustomerView>>;

  abstract findCustomer(id: UserId): Promise<CustomerDetailView | null>;
}
