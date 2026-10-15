/**
 * The data of the store that the ticket of an order prints (ADR-0163), from its configuration variables: the same
 * for every store, and changed with a restart.
 */
export interface StoreProfile {
  readonly name: string;
  readonly address: string | null;
  /** The RFC, in uppercase. */
  readonly taxId: string | null;
  readonly phone: string | null;
  /** By default, that the ticket is no tax receipt. */
  readonly ticketFooter: string;
}

/** Dependency injection token of the store profile (ADR-0163). */
export const STORE_PROFILE = Symbol('STORE_PROFILE');
