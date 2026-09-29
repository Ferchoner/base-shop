// Public API of the Identity & Access context (ADR-0005): other modules import only from this file.
export { IdentityAccessModule } from './identity-access.module.js';
export { IdentityAccessFacade } from './application/identity-access.facade.js';
export type { UserId, UserType } from './domain/user.js';
// For the operator script that creates the first superadmin (ADR-0116).
export { FirstSuperadminCommand } from './infrastructure/first-superadmin.command.js';
// For the maintainer script that builds the common password list (ADR-0115).
export { commonPasswordEntries } from './domain/password.js';
export { COMMON_PASSWORDS_FILE } from './infrastructure/file-common-passwords.js';
