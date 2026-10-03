import {
  type Id,
  InvalidStateTransitionError,
  InvalidValueError,
} from '../../../shared-kernel/index.js';
import { SameEmailError } from './identity-errors.js';
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
  /** Version of the privacy notice shown when a customer signed up (ADR-0067); `null` for staff. */
  readonly privacyNoticeVersion: string | null;
  readonly createdAt: Date;
  readonly roleIds: readonly RoleId[];
  readonly version: number;
}

/**
 * A customer or staff account (ADR-0043): its status, roles and sign-in (T-130, T-120), the creation and
 * reactivation of staff (T-131), and the anonymization of customers (T-132, ADR-0067).
 */
export class User {
  private constructor(private state: UserSnapshot) {}

  static restore(snapshot: UserSnapshot): User {
    return new User(snapshot);
  }

  /**
   * A new staff account (UC-IAM-13, BR-USR-09): ACTIVE, with at least one role and a temporary password it
   * must change on first sign-in. Its email is not verified: verification only matters to customers
   * (ADR-0046, ADR-0116).
   */
  static createStaff(input: {
    id: UserId;
    email: string;
    firstNames: string;
    lastNames: string;
    roleIds: readonly RoleId[];
    temporaryPasswordHash: string;
    now: Date;
  }): User {
    const user = new User({
      id: input.id,
      type: 'STAFF',
      status: 'ACTIVE',
      email: normalizeEmail(input.email),
      firstNames: input.firstNames,
      lastNames: input.lastNames,
      emailVerifiedAt: null,
      passwordHash: input.temporaryPasswordHash,
      passwordChangedAt: input.now,
      mustChangePassword: true,
      lastLoginAt: null,
      suspendedAt: null,
      anonymizedAt: null,
      privacyNoticeVersion: null,
      createdAt: input.now,
      roleIds: [],
      version: 1,
    });
    user.replaceRoles(input.roleIds);
    return user;
  }

  /**
   * A customer who signs up (UC-IAM-01, BR-USR-15): ACTIVE, with their own password, no roles, and an email
   * to verify before buying (BR-USR-05, ADR-0046). Keeps the privacy notice version they were shown
   * (ADR-0067).
   */
  static registerCustomer(input: {
    id: UserId;
    email: string;
    firstNames: string;
    lastNames: string;
    passwordHash: string;
    privacyNoticeVersion: string;
    now: Date;
  }): User {
    return new User({
      id: input.id,
      type: 'CUSTOMER',
      status: 'ACTIVE',
      email: normalizeEmail(input.email),
      firstNames: input.firstNames,
      lastNames: input.lastNames,
      emailVerifiedAt: null,
      passwordHash: input.passwordHash,
      passwordChangedAt: input.now,
      mustChangePassword: false,
      lastLoginAt: null,
      suspendedAt: null,
      anonymizedAt: null,
      privacyNoticeVersion: input.privacyNoticeVersion,
      createdAt: input.now,
      roleIds: [],
      version: 1,
    });
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

  get email(): string | null {
    return this.state.email;
  }

  get emailVerified(): boolean {
    return this.state.emailVerifiedAt !== null;
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
   * ADR-0076). An anonymized account is never reactivated. Staff is reactivated with `reactivateStaff`.
   */
  reactivateCustomer(): void {
    if (this.state.type !== 'CUSTOMER') {
      throw new Error('Staff is reactivated with a new temporary password');
    }
    if (this.state.status !== 'SUSPENDED') {
      throw new InvalidStateTransitionError(this.state.status, 'reactivate');
    }
    this.state = { ...this.state, status: 'ACTIVE', suspendedAt: null };
  }

  /**
   * SUSPENDED → ACTIVE for a staff member (BR-USR-14, ADR-0076): the suspension may have been over a leaked
   * password, so they get a new temporary password to change on their next sign-in. Their roles stay.
   */
  reactivateStaff(temporaryPasswordHash: string, at: Date): void {
    if (this.state.type !== 'STAFF') {
      throw new Error('A customer keeps their password when reactivated');
    }
    if (this.state.status !== 'SUSPENDED') {
      throw new InvalidStateTransitionError(this.state.status, 'reactivate');
    }
    this.state = {
      ...this.state,
      status: 'ACTIVE',
      suspendedAt: null,
      passwordHash: temporaryPasswordHash,
      passwordChangedAt: at,
      mustChangePassword: true,
    };
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

  /**
   * Replaces a forgotten password through a recovery link (UC-IAM-08, BR-USR-16): the person chose it, so a
   * pending temporary password ends too. Getting the link proves the account's address works, so an
   * unverified email becomes verified (ADR-0118).
   */
  resetPassword(passwordHash: string, at: Date): void {
    if (!this.canSignIn) {
      throw new InvalidStateTransitionError(
        this.state.status,
        'reset password',
      );
    }
    this.state = {
      ...this.state,
      passwordHash,
      passwordChangedAt: at,
      mustChangePassword: false,
      emailVerifiedAt: this.state.emailVerifiedAt ?? at,
    };
  }

  /**
   * Marks the email as verified (UC-IAM-02, ADR-0046), only while it is still the address the link was sent
   * to: a link for an address the account no longer has verifies nothing.
   */
  verifyEmail(sentTo: string, at: Date): boolean {
    if (!this.canSignIn || this.state.email !== sentTo) return false;
    this.state = { ...this.state, emailVerifiedAt: at };
    return true;
  }

  /**
   * A customer changes their email (UC-IAM-10, BR-USR-11): the new one stays unverified, so they cannot buy
   * until they verify it. The same email as now is not a change.
   */
  changeEmail(newEmail: string): void {
    if (this.state.type !== 'CUSTOMER') {
      throw new Error('Only customers change their own email');
    }
    if (!this.canSignIn) {
      throw new InvalidStateTransitionError(this.state.status, 'change email');
    }
    const email = normalizeEmail(newEmail);
    if (email === this.state.email) throw new SameEmailError();
    this.state = { ...this.state, email, emailVerifiedAt: null };
  }

  /** A customer corrects their names (ADR-0067); only the fields given change. */
  rectify(changes: { firstNames?: string; lastNames?: string }): void {
    if (this.state.type !== 'CUSTOMER') {
      throw new Error('Only customers rectify their own data');
    }
    if (!this.canSignIn) {
      throw new InvalidStateTransitionError(this.state.status, 'rectify');
    }
    this.state = {
      ...this.state,
      firstNames: changes.firstNames ?? this.state.firstNames,
      lastNames: changes.lastNames ?? this.state.lastNames,
    };
  }

  /**
   * Anonymizes a customer, ACTIVE or SUSPENDED (UC-IAM-19, ADR-0067): ANONYMIZED for good, without email, names,
   * password nor email verification, so the email is free for a new account. Staff is never anonymized
   * (BR-USR-06).
   *
   * @throws InvalidStateTransitionError when it was already anonymized.
   */
  anonymize(at: Date): void {
    if (this.state.type !== 'CUSTOMER') {
      throw new Error('Staff is never anonymized');
    }
    if (this.state.status === 'ANONYMIZED') {
      throw new InvalidStateTransitionError(this.state.status, 'anonymize');
    }
    this.state = {
      ...this.state,
      status: 'ANONYMIZED',
      email: null,
      firstNames: null,
      lastNames: null,
      emailVerifiedAt: null,
      passwordHash: null,
      anonymizedAt: at,
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
