import { toMoneyDto } from '../../../platform/http/money.dto.js';
import type {
  PromotionDetail,
  PromotionSummary,
} from '../application/promotion-reader.js';
import type { PromotionDto, PromotionSummaryDto } from './promotion.dto.js';

export function toPromotionSummaryDto(
  view: PromotionSummary,
): PromotionSummaryDto {
  return {
    id: view.id,
    name: view.name,
    status: view.status,
    percentage:
      view.discount.type === 'PERCENTAGE' ? view.discount.percentage : null,
    amountOff:
      view.discount.type === 'AMOUNT' ? toMoneyDto(view.discount.amount) : null,
    targetCount: view.targetCount,
    channels: [...view.channels],
    minimumSubtotal:
      view.minimumSubtotal === null ? null : toMoneyDto(view.minimumSubtotal),
    startsAt: view.startsAt,
    endsAt: view.endsAt,
    endedAt: view.endedAt,
    code: view.code,
    usageLimit: view.usageLimit,
    oncePerCustomer: view.oncePerCustomer,
    uses: view.uses,
  };
}

export function toPromotionDto(view: PromotionDetail): PromotionDto {
  return {
    ...toPromotionSummaryDto({ ...view, targetCount: view.targets.length }),
    targets: view.targets.map(({ type, id, name }) => ({ type, id, name })),
    endedBy: view.endedBy,
    createdBy: view.createdBy,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
    version: view.version,
  };
}
