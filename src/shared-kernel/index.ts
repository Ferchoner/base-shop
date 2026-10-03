// Shared kernel (ADR-0003, ADR-0088, ADR-0094): pure TypeScript used by every layer of every context.
export {
  type AuditChange,
  type AuditChanges,
  changesBetween,
  isAlwaysHiddenField,
  redactAuditChanges,
} from './audit-changes.js';
export {
  type AuditActor,
  type AuditEntry,
  type AuditResult,
  AuditTrail,
} from './audit-trail.js';
export { Clock } from './clock.js';
export {
  assertVersion,
  DomainError,
  type DomainErrorCategory,
  DuplicateValueError,
  InvalidStateTransitionError,
  InvalidValueError,
  NotFoundError,
  ResourceInUseError,
  VersionConflictError,
} from './domain-error.js';
export { type DomainEvent, eventMetadata } from './domain-event.js';
export {
  EmailDeliveryError,
  type EmailMessage,
  EmailSender,
} from './email-sender.js';
export { DomainEventPublisher } from './domain-event-publisher.js';
export { FrontendLinks } from './frontend-links.js';
export { lifetimeInWords } from './lifetime-in-words.js';
export { hashLinkToken, newLinkToken } from './link-tokens.js';
export {
  InvalidOrExpiredTokenError,
  isUsableLink,
  type OneTimeLink,
} from './one-time-link.js';
export {
  CLEANUP_BATCH_SIZE,
  CLEANUP_MAX_BATCHES,
  daysBefore,
  deleteInBatches,
  monthsBefore,
} from './cleanup.js';
export { inMexicoTime } from './mexico-time.js';
export { type Id, newCredentialId, newId, toId } from './id.js';
export { type Currency, MAX_MONEY_AMOUNT, Money } from './money.js';
export {
  type Page,
  pageOffset,
  type PageRequest,
  type SortOrder,
} from './pagination.js';
export {
  isPermissionCode,
  PERMISSION_CODES,
  type PermissionCode,
  PERMISSIONS,
} from './permissions.js';
export { TransactionManager } from './transaction-manager.js';
