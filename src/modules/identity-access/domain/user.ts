import {
  type Id,
  InvalidStateTransitionError,
  InvalidValueError,
} from '../../../shared-kernel/index.js';
import type { RoleId } from './role.js';

export type UserId = Id<'User'>;
export type UserType = 'CUSTOMER' | 'STAFF';
export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'ANONYMIZED';

/** Emails are stored and compared in lowercase, without surrounding spaces (BR-USR-01, API_SPEC.md §9.2). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface UserSnapshot {
  readonly id: UserId;
  /** Customers never have roles and staff never buys (BR-USR-08). */
  readonly type: UserType;
  readonly status: UserStatus;
  /** `null` only for an anonymized customer (ADR-0067). */
  readonly email: string | null;
  readonly firstNames: string | null;
  readonly lastNames: string | null;
  readonly emailVerifiedAt: Date | null;
  /** Argon2id hash in PHC format (ADR-0023, ADR-0114); `null` only for an anonymized customer. */
  readonly passwordHash: string | null;
  readonly passwordChangedAt: Date | null;
  readonly mustChangePassword: boolean;
  readonly lastLoginAt: Date | null;
  readonly suspendedAt: Date | null;
  readonly anonymizedAt: Date | null;
  readonly createdAt: Date;
  readonly roleIds: readonly RoleId[];
  readonly version: number;
}

/**
 * A customer or staff account (ADR-0043): its status, roles and sign-in (T-130, T-120). Staff creation and
 * reactivation come with T-131, and anonymization with T-132.
 */
export class User {
  private constructor(private state: UserSnapshot) {}

  static restore(snapshot: UserSnapshot): User {
    return new User(snapshot);
  }

  get id(): UserId {
    return this.state.id;
  }

  get type(): UserType {
    return this.state.type;
  }

  get status(): UserStatus {
    return this.state.status;
  }

  get roleIds(): readonly RoleId[] {
    return this.state.roleIds;
  }

  get passwordHash(): string | null {
    return this.state.passwordHash;
  }

  /** Staff with a temporary password, who may only change it (BR-USR-09, ADR-0071). */
  get mustChangePassword(): boolean {
    return this.state.mustChangePassword;
  }

  /**
   * Whether the account may sign in and keep its sessions: only ACTIVE accounts (BR-USR-02). An anonymized
   * customer has no password left either.
   */
  get canSignIn(): boolean {
    return this.state.status === 'ACTIVE' && this.state.passwordHash !== null;
  }

  get version(): number {
    return this.state.version;
  }

  /** ACTIVE → SUSPENDED (BR-USR-02, BR-USR-06): the account can no longer sign in. */
  suspend(at: Date): void {
    if (this.state.status !== 'ACTIVE') {
      throw new InvalidStateTransitionError(this.state.status, 'suspend');
    }
    this.state = { ...this.state, status: 'SUSPENDED', suspendedAt: at };
  }

  /**
   * SUSPENDED → ACTIVE for a customer, who keeps the password and the email verification (BR-USR-14,
   * ADR-0076). An anonymized account is never reactivated. Staff reactivation also issues a temporary
   * password, so it comes with T-131.
   */
  reactivateCustomer(): void {
    if (this.state.type !== 'CUSTOMER') {
      throw new Error('Staff reactivation issues a temporary password (T-131)');
    }
    if (this.state.status !== 'SUSPENDED') {
      throw new InvalidStateTransitionError(this.state.status, 'reactivate');
    }
    this.state = { ...this.state, status: 'ACTIVE', suspendedAt: null };
  }

  /** The staff member's roles, replaced as a whole; at least one (API_SPEC.md §9.17, BR-USR-08). */
  replaceRoles(roleIds: readonly RoleId[]): void {
    if (this.state.type !== 'STAFF') {
      throw new InvalidValueError('Customers never have roles');
    }
    const unique = [...new Set(roleIds)];
    if (unique.length === 0) {
      throw new InvalidValueError('A staff member has at least one role');
    }
    this.state = { ...this.state, roleIds: unique };
  }

  /**
   * Replaces the password with a new hash, already checked against the policy (UC-IAM-09, BR-USR-10). It
   * also ends a pending change of a temporary password (BR-USR-09). Only an account that can sign in has a
   * password to change.
   */
  changePassword(passwordHash: string, at: Date): void {
    if (!this.canSignIn) {
      throw new InvalidStateTransitionError(
        this.state.status,
        'change password',
      );
    }
    this.state = {
      ...this.state,
      passwordHash,
      passwordChangedAt: at,
      mustChangePassword: false,
    };
  }

  /** Called by the repository once a change is saved. */
  markSaved(version: number): void {
    this.state = { ...this.state, version };
  }

  snapshot(): UserSnapshot {
    return this.state;
  }
}
