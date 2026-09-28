import { type Id, NotFoundError, toId } from '../../../shared-kernel/index.js';
import type {
  AddressView,
  CustomerDetailView,
  CustomerView,
  RoleView,
  StaffView,
} from '../application/identity.queries.js';
import type {
  AdminCustomerDto,
  RoleDto,
  StaffUserDto,
} from './identity-admin.dto.js';
import type { AddressDto } from './address.dto.js';

/**
 * An ID from the URL. One that is not a UUID cannot exist, so it is answered 404 like any missing resource.
 */
export function pathId<Entity extends string>(
  value: string,
  resource: string,
): Id<Entity> {
  try {
    return toId<Entity>(value);
  } catch {
    throw new NotFoundError(resource, value);
  }
}

export function toRoleDto(view: RoleView): RoleDto {
  return { ...view, permissions: [...view.permissions] };
}

export function toStaffUserDto(view: StaffView): StaffUserDto {
  return { ...view, roles: view.roles.map(({ id, name }) => ({ id, name })) };
}

export function toAddressDto(view: AddressView): AddressDto {
  return { ...view, country: 'MX' };
}

export function toAdminCustomerDto(
  view: CustomerView | CustomerDetailView,
): AdminCustomerDto {
  if (!('addresses' in view)) return { ...view };
  return { ...view, addresses: view.addresses.map(toAddressDto) };
}
