import { Injectable } from '@nestjs/common';
import {
  Clock,
  type Page,
  type PageRequest,
  type SortOrder,
} from '../../../shared-kernel/index.js';
import {
  type PromotionId,
  type PromotionStatus,
  promotionStatus,
  type PromotionTarget,
} from '../domain/promotion.js';
import { PromotionCatalog } from './promotion-ports.js';
import {
  type PromotionFilter,
  PromotionQueries,
  type PromotionSortField,
  type PromotionSummaryView,
  type PromotionView,
} from './promotions.queries.js';

/** A target with its name as Catalog gives it now; `null` if Catalog no longer has it. */
export interface NamedTarget extends PromotionTarget {
  readonly name: string | null;
}

export interface PromotionSummary extends PromotionSummaryView {
  readonly status: PromotionStatus;
}

/** A promotion with its status now and the names of its targets (UC-PRM-02). */
export interface PromotionDetail extends Omit<PromotionView, 'targets'> {
  readonly status: PromotionStatus;
  readonly targets: readonly NamedTarget[];
}

/** Reads promotions with their status at the moment of the read, and the names Catalog gives their targets. */
@Injectable()
export class PromotionReader {
  constructor(
    private readonly queries: PromotionQueries,
    private readonly catalog: PromotionCatalog,
    private readonly clock: Clock,
  ) {}

  /** `null` when it does not exist. */
  async promotion(id: PromotionId): Promise<PromotionDetail | null> {
    const view = await this.queries.findPromotion(id);
    if (view === null) return null;
    const keyOf = ({ type, id }: PromotionTarget) => `${type}:${id}`;
    const names = new Map(
      (await this.catalog.targets(view.targets)).map((target) => [
        keyOf(target),
        target.name,
      ]),
    );
    return {
      ...view,
      status: promotionStatus(view, this.clock.now()),
      targets: view.targets.map((target) => ({
        ...target,
        name: names.get(keyOf(target)) ?? null,
      })),
    };
  }

  async list(
    filter: PromotionFilter,
    sort: readonly SortOrder<PromotionSortField>[],
    page: PageRequest,
  ): Promise<Page<PromotionSummary>> {
    const now = this.clock.now();
    const found = await this.queries.listPromotions(filter, sort, page, now);
    return {
      ...found,
      items: found.items.map((item) => ({
        ...item,
        status: promotionStatus(item, now),
      })),
    };
  }
}
