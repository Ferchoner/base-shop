// Public API of the Identity & Access context (ADR-0005): other modules import only from this file.
export { IdentityAccessModule } from './identity-access.module.js';
export { IdentityAccessFacade } from './application/identity-access.facade.js';
export type { UserId, UserType } from './domain/user.js';
