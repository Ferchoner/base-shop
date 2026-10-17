import { Injectable } from '@nestjs/common';
import {
  AuditTrail,
  changesBetween,
  Clock,
  newId,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import {
  type NewPromotionTerms,
  Promotion,
  type PromotionId,
  type UserId,
} from '../domain/promotion.js';
import { PromotionRepository } from '../domain/promotion.repository.js';
import { PromotionCatalog } from './promotion-ports.js';
import { assertTargets, auditedPromotionFields } from './promotion-support.js';

/**
 * Creates a promotion (UC-PRM-01, ADR-0168), from its start, or from now without one. Its products, categories and
 * brands must exist and be in use. Audited as `promotions.create`.
 */
@Injectable()
export class CreatePromotion {
  constructor(
    private readonly promotions: PromotionRepository,
    private readonly catalog: PromotionCatalog,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  /** @throws UnusableTargetsError; PromotionEndError; InvalidValueError. */
  execute(input: {
    staffId: UserId;
    terms: NewPromotionTerms;
  }): Promise<PromotionId> {
    return this.transactions.run(async () => {
      const now = this.clock.now();
      const promotion = Promotion.create({
        id: newId(),
        terms: input.terms,
        createdBy: input.staffId,
        at: now,
      });
      await assertTargets(this.catalog, promotion.snapshot.targets);
      await this.promotions.insert(promotion, now);
      const created = auditedPromotionFields(promotion);
      await this.audit.record({
        action: 'promotions.create',
        resource: { type: 'promotion', id: promotion.id },
        changes: changesBetween(
          Object.fromEntries(Object.keys(created).map((key) => [key, null])),
          created,
        ),
      });
      return promotion.id;
    });
  }
}
