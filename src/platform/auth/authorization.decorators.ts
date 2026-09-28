import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiBearerAuth, ApiExtension } from '@nestjs/swagger';
import type { PermissionCode } from '../../shared-kernel/index.js';

export const REQUIRED_PERMISSIONS = 'authorization:permissions';
export const REQUIRED_ACCOUNT = 'authorization:account';

export interface AccountRequirement {
  /** Only customers: a staff token gets 403 `forbidden` (API_SPEC.md §3.2). */
  readonly customerOnly?: boolean;
  /** Also for staff with a temporary password (`GET /v1/me`, `POST /v1/me/password`, logout). */
  readonly allowPendingPasswordChange?: boolean;
}

/**
 * An administrative route (`/v1/admin/...`, ADR-0036): an ACTIVE staff token with every listed permission.
 * Without a token, 401 `unauthenticated`; a customer or a staff member without the permission, 403
 * `forbidden` (audited, ADR-0100); a staff member with a temporary password, 403 `password-change-required`.
 */
export function RequirePermissions(
  ...permissions: [PermissionCode, ...PermissionCode[]]
): MethodDecorator & ClassDecorator {
  return applyDecorators(
    SetMetadata(REQUIRED_PERMISSIONS, permissions),
    ApiBearerAuth('bearer'),
    ApiExtension('x-required-permissions', permissions),
  );
}

/** An account route (`/v1/me/...`, ADR-0036): any ACTIVE account token, or only customers. */
export function RequireAccount(
  requirement: AccountRequirement = {},
): MethodDecorator & ClassDecorator {
  return applyDecorators(
    SetMetadata(REQUIRED_ACCOUNT, requirement),
    ApiBearerAuth('bearer'),
  );
}
