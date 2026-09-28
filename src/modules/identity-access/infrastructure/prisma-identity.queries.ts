import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { Prisma } from '../../../platform/persistence/prisma/generated/client.js';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import {
  isPermissionCode,
  type Page,
  pageOffset,
  type PageRequest,
  PERMISSION_CODES,
  type SortOrder,
  toId,
} from '../../../shared-kernel/index.js';
import {
  type AddressView,
  type CustomerDetailView,
  type CustomerFilter,
  type CustomerSortField,
  type CustomerView,
  IdentityQueries,
  type RoleFilter,
  type RoleSortField,
  type RoleView,
  type StaffFilter,
  type StaffSortField,
  type StaffView,
} from '../application/identity.queries.js';
import type { RoleId } from '../domain/role.js';
import type { UserId } from '../domain/user.js';

const ROLE_FIELDS = {
  id: true,
  name: true,
  description: true,
  isSuperadmin: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  permissions: { select: { permissionCode: true } },
  _count: { select: { users: true } },
} as const;

const STAFF_FIELDS = {
  id: true,
  email: true,
  firstNames: true,
  lastNames: true,
  status: true,
  mustChangePassword: true,
  lastLoginAt: true,
  version: true,
  createdAt: true,
  roles: {
    select: { role: { select: { id: true, name: true } } },
    orderBy: { role: { name: 'asc' } },
  },
} as const;

const CUSTOMER_FIELDS = {
  id: true,
  email: true,
  firstNames: true,
  lastNames: true,
  status: true,
  emailVerifiedAt: true,
  createdAt: true,
  lastLoginAt: true,
  anonymizedAt: true,
  version: true,
} as const;

type RoleRow = Prisma.RoleGetPayload<{ select: typeof ROLE_FIELDS }>;
type StaffRow = Prisma.UserGetPayload<{ select: typeof STAFF_FIELDS }>;
type CustomerRow = Prisma.UserGetPayload<{ select: typeof CUSTOMER_FIELDS }>;

/** Case-insensitive "contains" for `q`. */
function containing(q: string): { contains: string; mode: 'insensitive' } {
  return { contains: q, mode: 'insensitive' };
}

/**
 * The requested order, then the ID so pages are stable (ADR-0036). Accounts that never signed in go last
 * when sorting by `lastLoginAt`.
 */
function orderBy<Field extends string>(
  sort: readonly SortOrder<Field>[],
): Record<string, unknown>[] {
  return [
    ...sort.map(({ field, direction }) =>
      field === 'lastLoginAt'
        ? { [field]: { sort: direction, nulls: 'last' } }
        : { [field]: direction },
    ),
    { id: 'asc' },
  ];
}

/** Read models of Identity & Access (ADR-0112), straight from `users`, `roles` and `customer_addresses`. */
@Injectable()
export class PrismaIdentityQueries extends IdentityQueries {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  async listRoles(
    filter: RoleFilter,
    sort: readonly SortOrder<RoleSortField>[],
    page: PageRequest,
  ): Promise<Page<RoleView>> {
    const where: Prisma.RoleWhereInput =
      filter.q === undefined ? {} : { name: containing(filter.q) };
    const [rows, totalItems] = await Promise.all([
      this.txHost.tx.role.findMany({
        select: ROLE_FIELDS,
        where,
        orderBy: orderBy(sort) as Prisma.RoleOrderByWithRelationInput[],
        skip: pageOffset(page),
        take: page.pageSize,
      }),
      this.txHost.tx.role.count({ where }),
    ]);
    return { items: rows.map(toRoleView), totalItems };
  }

  async findRole(id: RoleId): Promise<RoleView | null> {
    const row = await this.txHost.tx.role.findUnique({
      select: ROLE_FIELDS,
      where: { id },
    });
    return row === null ? null : toRoleView(row);
  }

  async listStaff(
    filter: StaffFilter,
    sort: readonly SortOrder<StaffSortField>[],
    page: PageRequest,
  ): Promise<Page<StaffView>> {
    const where: Prisma.UserWhereInput = {
      type: 'STAFF',
      ...(filter.q === undefined
        ? {}
        : {
            OR: [
              { email: containing(filter.q) },
              { firstNames: containing(filter.q) },
              { lastNames: containing(filter.q) },
            ],
          }),
      ...(filter.status === undefined
        ? {}
        : { status: { in: [...filter.status] } }),
      ...(filter.roleId === undefined
        ? {}
        : { roles: { some: { roleId: filter.roleId } } }),
    };
    const [rows, totalItems] = await Promise.all([
      this.txHost.tx.user.findMany({
        select: STAFF_FIELDS,
        where,
        orderBy: orderBy(sort) as Prisma.UserOrderByWithRelationInput[],
        skip: pageOffset(page),
        take: page.pageSize,
      }),
      this.txHost.tx.user.count({ where }),
    ]);
    return { items: rows.map(toStaffView), totalItems };
  }

  async findStaff(id: UserId): Promise<StaffView | null> {
    const row = await this.txHost.tx.user.findFirst({
      select: STAFF_FIELDS,
      where: { id, type: 'STAFF' },
    });
    return row === null ? null : toStaffView(row);
  }

  async listCustomers(
    filter: CustomerFilter,
    sort: readonly SortOrder<CustomerSortField>[],
    page: PageRequest,
  ): Promise<Page<CustomerView>> {
    const where: Prisma.UserWhereInput = {
      type: 'CUSTOMER',
      ...(filter.q === undefined
        ? {}
        : {
            OR: [
              { email: containing(filter.q) },
              { firstNames: containing(filter.q) },
              { lastNames: containing(filter.q) },
            ],
          }),
      ...(filter.status === undefined
        ? {}
        : { status: { in: [...filter.status] } }),
      ...(filter.emailVerified === undefined
        ? {}
        : { emailVerifiedAt: filter.emailVerified ? { not: null } : null }),
      ...(filter.createdFrom === undefined && filter.createdTo === undefined
        ? {}
        : { createdAt: { gte: filter.createdFrom, lte: filter.createdTo } }),
    };
    const [rows, totalItems] = await Promise.all([
      this.txHost.tx.user.findMany({
        select: CUSTOMER_FIELDS,
        where,
        orderBy: orderBy(sort) as Prisma.UserOrderByWithRelationInput[],
        skip: pageOffset(page),
        take: page.pageSize,
      }),
      this.txHost.tx.user.count({ where }),
    ]);
    return { items: rows.map(toCustomerView), totalItems };
  }

  async findCustomer(id: UserId): Promise<CustomerDetailView | null> {
    const row = await this.txHost.tx.user.findFirst({
      select: {
        ...CUSTOMER_FIELDS,
        addresses: {
          include: {
            state: { select: { name: true } },
            municipality: { select: { name: true } },
          },
          orderBy: [
            { isDefault: 'desc' },
            { createdAt: 'desc' },
            { id: 'asc' },
          ],
        },
      },
      where: { id, type: 'CUSTOMER' },
    });
    if (row === null) return null;
    const addresses: AddressView[] = row.addresses.map((address) => ({
      id: address.id,
      recipientName: address.recipientName,
      phone: address.phone,
      street: address.street,
      exteriorNumber: address.exteriorNumber,
      interiorNumber: address.interiorNumber,
      neighborhood: address.neighborhood,
      postalCode: address.postalCode,
      stateCode: address.stateCode,
      stateName: address.state.name,
      municipalityCode: address.municipalityCode,
      municipalityName: address.municipality.name,
      city: address.city,
      references: address.references,
      isDefault: address.isDefault,
      createdAt: address.createdAt,
      updatedAt: address.updatedAt,
    }));
    return { ...toCustomerView(row), addresses, orderCount: 0 };
  }
}

function toRoleView(row: RoleRow): RoleView {
  return {
    id: toId<'Role'>(row.id),
    name: row.name,
    description: row.description,
    isSuperadmin: row.isSuperadmin,
    permissions: row.isSuperadmin
      ? PERMISSION_CODES
      : row.permissions
          .map(({ permissionCode }) => permissionCode)
          .filter(isPermissionCode)
          .sort(),
    userCount: row._count.users,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toStaffView(row: StaffRow): StaffView {
  return {
    id: toId<'User'>(row.id),
    // Staff is never anonymized, so these are never NULL (CHECK on users, DATABASE.md §3.1).
    email: row.email as string,
    firstNames: row.firstNames as string,
    lastNames: row.lastNames as string,
    status: row.status,
    mustChangePassword: row.mustChangePassword,
    roles: row.roles.map(({ role }) => ({
      id: toId<'Role'>(role.id),
      name: role.name,
    })),
    lastLoginAt: row.lastLoginAt,
    version: row.version,
    createdAt: row.createdAt,
  };
}

function toCustomerView(row: CustomerRow): CustomerView {
  return {
    id: toId<'User'>(row.id),
    email: row.email,
    firstNames: row.firstNames,
    lastNames: row.lastNames,
    status: row.status,
    emailVerified: row.emailVerifiedAt !== null,
    createdAt: row.createdAt,
    lastLoginAt: row.lastLoginAt,
    anonymizedAt: row.anonymizedAt,
    version: row.version,
  };
}
