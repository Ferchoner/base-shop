import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  Clock,
  daysBefore,
  deleteInBatches,
} from '../../../shared-kernel/index.js';

/** Days a guest cart is kept without activity (BR-CRT-06): `INACTIVE_GUEST_CART_RETENTION_DAYS`, 30 by default (ADR-0149). */
export const INACTIVE_GUEST_CART_RETENTION_DAYS = Symbol(
  'INACTIVE_GUEST_CART_RETENTION_DAYS',
);

/**
 * Guest carts without activity, deleted in batches with their lines (BR-CRT-06, ADR-0144). Each call deletes at
 * most `limit` carts in one statement and answers how many it deleted. An abstract class rather than an
 * interface, so it can be the dependency injection token without depending on NestJS.
 */
export abstract class InactiveGuestCarts {
  /** Guest carts, in any status, whose last activity was before `before`; never a customer's cart. */
  abstract delete(before: Date, limit: number): Promise<number>;
}

/**
 * The daily cleanup of Shopping (UC-CRT-07, UC-SYS-01, ADR-0029, ADR-0144): guest carts INACTIVE_GUEST_CART_RETENTION_DAYS
 * after their last activity, also those of an order or merged into an account. A customer's cart is always kept. A system task:
 * not audited.
 */
@Injectable()
export class GuestCartCleanup {
  private readonly logger = new Logger(GuestCartCleanup.name);

  constructor(
    private readonly carts: InactiveGuestCarts,
    private readonly clock: Clock,
    @Inject(INACTIVE_GUEST_CART_RETENTION_DAYS)
    private readonly days: number,
  ) {}

  /** Answers how many carts it deleted. */
  async run(): Promise<number> {
    const before = daysBefore(this.clock.now(), this.days);
    const deleted = await deleteInBatches((limit) =>
      this.carts.delete(before, limit),
    );
    this.logger.log(`Deleted ${deleted} inactive guest carts`);
    return deleted;
  }
}
