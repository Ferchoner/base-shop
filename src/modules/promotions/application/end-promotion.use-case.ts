import { Injectable } from '@nestjs/common';
import {
  assertVersion,
  AuditTrail,
  changesBetween,
  Clock,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import type { PromotionId, UserId } from '../domain/promotion.js';
import { PromotionRepository } from '../domain/promotion.repository.js';
import { findPromotion } from './promotion-support.js';

/**
 * Ends a promotion now (UC-PRM-03, ADR-0168), with optimistic locking: an active one stops applying, and a scheduled
 * one never starts. It is kept, since orders keep which promotion they got. Audited as `promotions.end`.
 */
@Injectable()
export class EndPromotion {
  constructor(
    private readonly promotions: PromotionRepository,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  /** @throws NotFoundError; VersionConflictError; InvalidStateTransitionError when it ended already. */
  execute(input: {
    id: PromotionId;
    staffId: UserId;
    version: number;
  }): Promise<void> {
    return this.transactions.run(async () => {
      const now = this.clock.now();
      const promotion = await findPromotion(this.promotions, input.id);
      assertVersion(promotion.version, input.version);
      promotion.end(input.staffId, now);
      await this.promotions.save(promotion, now);
      await this.audit.record({
        action: 'promotions.end',
        resource: { type: 'promotion', id: input.id },
        changes: changesBetween({ endedAt: null }, { endedAt: now }),
      });
    });
  }
}
