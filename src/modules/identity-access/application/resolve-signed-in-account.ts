import { Injectable } from '@nestjs/common';
import { Clock, type PermissionCode } from '../../../shared-kernel/index.js';
import { RoleRepository } from '../domain/role.repository.js';
import type { SessionId } from '../domain/session.js';
import { SessionRepository } from '../domain/session.repository.js';
import type { UserId, UserType } from '../domain/user.js';
import { UserRepository } from '../domain/user.repository.js';
import { effectivePermissions } from './effective-permissions.js';

/** Who is calling, as authorization needs it (`AuthenticatedUser`, ADR-0111). */
export interface SignedInAccount {
  readonly id: UserId;
  readonly type: UserType;
  readonly permissions: readonly PermissionCode[];
  readonly mustChangePassword: boolean;
  readonly sessionId: SessionId;
}

/**
 * The account behind a valid access token, read on every request (ADR-0114): `null` when the account can no
 * longer sign in or the session was revoked. So a suspension, a sign-out, a revoked session or a change of
 * roles or permissions applies to the next request, not when the token expires.
 */
@Injectable()
export class ResolveSignedInAccount {
  constructor(
    private readonly users: UserRepository,
    private readonly roles: RoleRepository,
    private readonly sessions: SessionRepository,
    private readonly clock: Clock,
  ) {}

  async execute(
    userId: UserId,
    sessionId: SessionId,
  ): Promise<SignedInAccount | null> {
    const [user, active] = await Promise.all([
      this.users.findById(userId),
      this.sessions.isActive(sessionId, userId, this.clock.now()),
    ]);
    if (user === null || !user.canSignIn || !active) return null;
    return {
      id: user.id,
      type: user.type,
      permissions: await effectivePermissions(user, this.roles),
      mustChangePassword: user.mustChangePassword,
      sessionId,
    };
  }
}
