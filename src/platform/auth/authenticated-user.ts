import {
  isPermissionCode,
  type PermissionCode,
} from '../../shared-kernel/index.js';

/**
 * The signed-in account of a request, in `request.user` (ADR-0111). Authentication sets it from the access
 * token, only for ACTIVE accounts with an active session, reading the account on every request (ADR-0114);
 * authorization and the audit trail read it.
 */
export interface AuthenticatedUser {
  readonly id: string;
  readonly type: 'CUSTOMER' | 'STAFF';
  /** Permissions of the staff member's roles; always empty for customers (BR-USR-08). */
  readonly permissions: readonly PermissionCode[];
  /** Staff with a temporary password, who may only change it (ADR-0071). */
  readonly mustChangePassword: boolean;
  /** The session of the access token, kept when the user changes their password (ADR-0072). */
  readonly sessionId: string;
}

/** `request.user` when it is a well-formed authenticated user; anything else counts as signed out. */
export function authenticatedUserOf(request: {
  user?: unknown;
}): AuthenticatedUser | undefined {
  const user = request.user as Partial<AuthenticatedUser> | undefined;
  if (
    typeof user !== 'object' ||
    user === null ||
    typeof user.id !== 'string' ||
    (user.type !== 'CUSTOMER' && user.type !== 'STAFF') ||
    !Array.isArray(user.permissions) ||
    !user.permissions.every(isPermissionCode) ||
    typeof user.mustChangePassword !== 'boolean' ||
    typeof user.sessionId !== 'string'
  ) {
    return undefined;
  }
  return user as AuthenticatedUser;
}
