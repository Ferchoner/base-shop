import { NotFoundError } from '../../../shared-kernel/index.js';
import type {
  Promotion,
  PromotionId,
  PromotionTarget,
} from '../domain/promotion.js';
import { UnusableTargetsError } from '../domain/promotion-errors.js';
import { PromotionRepository } from '../domain/promotion.repository.js';
import { PromotionCatalog } from './promotion-ports.js';

/** @throws NotFoundError when it does not exist. */
export async function findPromotion(
  promotions: PromotionRepository,
  id: PromotionId,
): Promise<Promotion> {
  const promotion = await promotions.find(id);
  if (promotion === null) throw new NotFoundError('Promotion', id);
  return promotion;
}

/**
 * Checks that the products, categories and brands a promotion targets exist and are in use (ADR-0168). The ones it
 * already had are not checked again: they stay even if they are no longer in use.
 *
 * @throws UnusableTargetsError naming each target by its place in `targets`.
 */
export async function assertTargets(
  catalog: PromotionCatalog,
  targets: readonly PromotionTarget[],
  kept: readonly PromotionTarget[] = [],
): Promise<void> {
  const keyOf = ({ type, id }: PromotionTarget) => `${type}:${id}`;
  const keptKeys = new Set(kept.map(keyOf));
  const added = targets.filter((target) => !keptKeys.has(keyOf(target)));
  if (added.length === 0) return;
  const found = new Map(
    (await catalog.targets(added)).map((target) => [keyOf(target), target]),
  );
  const problems = targets.flatMap(
    (target, index): { index: number; problem: 'unknown' | 'unusable' }[] => {
      if (keptKeys.has(keyOf(target))) return [];
      const entry = found.get(keyOf(target));
      if (entry === undefined) return [{ index, problem: 'unknown' }];
      return entry.usable ? [] : [{ index, problem: 'unusable' }];
    },
  );
  if (problems.length > 0) throw new UnusableTargetsError(problems);
}

/** The fields of a promotion its audit entries compare (ADR-0100); none is personal data. */
export function auditedPromotionFields(
  promotion: Promotion,
): Record<string, unknown> {
  const p = promotion.snapshot;
  return {
    name: p.name,
    percentage: p.discount.type === 'PERCENTAGE' ? p.discount.percentage : null,
    amountOff: p.discount.type === 'AMOUNT' ? p.discount.amount : null,
    targets: p.targets.map(({ type, id }) => ({ type, id })),
    channels: p.channels,
    minimumSubtotal: p.minimumSubtotal,
    startsAt: p.startsAt,
    endsAt: p.endsAt,
    // Only a coupon has limits of use: an automatic promotion audits none.
    code: p.code,
    usageLimit: p.usageLimit,
    oncePerCustomer: p.code === null ? null : p.oncePerCustomer,
  };
}
