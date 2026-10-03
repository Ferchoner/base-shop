import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import { CustomerCarts } from '../application/customer-carts.js';
import type { CustomerId } from '../domain/cart.js';
import { CUSTOMER_CART_LOCK } from './prisma-cart.repository.js';

/**
 * The carts of a customer in `carts` (DATABASE.md §7.1), deleted when the customer is anonymized (ADR-0067). Their
 * lines, and the guest carts merged into them, go by cascade.
 */
@Injectable()
export class PrismaCustomerCarts extends CustomerCarts {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  async deleteOf(customer: CustomerId): Promise<void> {
    const tx = this.txHost.tx;
    // $executeRaw, because Prisma cannot read the `void` value that the function returns.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CUSTOMER_CART_LOCK}::int, hashtext(${customer}))`;
    await tx.$executeRaw`DELETE FROM carts WHERE owner_user_id = ${customer}::uuid`;
  }
}
