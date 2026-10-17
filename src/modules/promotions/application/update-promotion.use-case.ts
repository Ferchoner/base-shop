import { Injectable } from '@nestjs/common';
import {
  assertVersion,
  AuditTrail,
  changesBetween,
  Clock,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import type { PromotionChanges, PromotionId } from '../domain/promotion.js';
import { PromotionRepository } from '../domain/promotion.repository.js';
import { PromotionCatalog } from './promotion-ports.js';
import {
  assertTargets,
  auditedPromotionFields,
  findPromotion,
} from './promotion-support.js';

/**
 * Changes the terms of a promotion (UC-PRM-03, ADR-0168), with optimistic locking: before it starts, any of them;
 * once started, only its name and its end. A new product, category or brand must exist and be in use; the ones it
 * already had stay even if they are no longer. Without changes, nothing is saved or audited. Audited as
 * `promotions.update`.
 */
@Injectable()
export class UpdatePromotion {
  constructor(
    private readonly promotions: PromotionRepository,
    private readonly catalog: PromotionCatalog,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  /**
   * @throws NotFoundError; VersionConflictError; InvalidStateTransitionError when it ended, or started and the change
   *   is to a term other than its name and its end; UnusableTargetsError; PromotionEndError; InvalidValueError.
   */
  execute(
    id: PromotionId,
    changes: PromotionChanges,
    version: number,
  ): Promise<void> {
    return this.transactions.run(async () => {
      const now = this.clock.now();
      const promotion = await findPromotion(this.promotions, id);
      assertVersion(promotion.version, version);
      const before = auditedPromotionFields(promotion);
      const kept = promotion.snapshot.targets;
      promotion.edit(changes, now);
      if (promotion.targetsChanged) {
        await assertTargets(this.catalog, promotion.snapshot.targets, kept);
      }
      const changed = changesBetween(before, auditedPromotionFields(promotion));
      if (Object.keys(changed).length === 0) return;
      await this.promotions.save(promotion, now);
      await this.audit.record({
        action: 'promotions.update',
        resource: { type: 'promotion', id },
        changes: changed,
      });
    });
  }
}
