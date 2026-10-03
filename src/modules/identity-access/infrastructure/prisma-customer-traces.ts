import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import { CustomerTraces } from '../application/anonymize-customer.use-case.js';
import type { UserId } from '../domain/user.js';

/**
 * `refresh_tokens`, `email_verification_tokens`, `password_reset_tokens` and `customer_addresses` of a customer
 * being anonymized (DATABASE.md §3.5 and §3.6, ADR-0067), deleted in the transaction of the anonymization.
 */
@Injectable()
export class PrismaCustomerTraces extends CustomerTraces {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  async deleteOf(customerId: UserId): Promise<void> {
    const tx = this.txHost.tx;
    const where = { userId: customerId };
    await tx.refreshToken.deleteMany({ where });
    await tx.emailVerificationToken.deleteMany({ where });
    await tx.passwordResetToken.deleteMany({ where });
    await tx.customerAddress.deleteMany({ where });
  }
}
