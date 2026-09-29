import { Injectable } from '@nestjs/common';
import {
  AuditTrail,
  changesBetween,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import type { UserId } from '../domain/user.js';
import { UserRepository } from '../domain/user.repository.js';
import { findUserOfType } from './user-support.js';

/**
 * A customer corrects their names (`PATCH /v1/me`, the rectification right of ADR-0067). Only the fields
 * given change; the email is changed with its own use case. Audited without the values (ADR-0067, ADR-0117).
 */
@Injectable()
export class RectifyCustomer {
  constructor(
    private readonly users: UserRepository,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
  ) {}

  execute(input: {
    userId: UserId;
    firstNames?: string;
    lastNames?: string;
  }): Promise<void> {
    return this.transactions.run(async () => {
      const user = await findUserOfType(this.users, input.userId, 'CUSTOMER');
      const { firstNames, lastNames } = user.snapshot();
      user.rectify({
        firstNames: input.firstNames,
        lastNames: input.lastNames,
      });
      const after = user.snapshot();
      const changes = changesBetween(
        { firstNames, lastNames },
        { firstNames: after.firstNames, lastNames: after.lastNames },
      );
      if (Object.keys(changes).length === 0) return;
      await this.users.save(user, user.id);
      await this.audit.record({
        action: 'customers.rectify',
        resource: { type: 'user', id: user.id },
        changes,
      });
    });
  }
}
