import type { Promotion, PromotionChannel, PromotionId } from './promotion.js';

/**
 * Persistence of promotions (DATABASE.md §18). An abstract class rather than an interface, so it can be the
 * dependency injection token without depending on NestJS.
 */
export abstract class PromotionRepository {
  /** Saves a new promotion with its targets, in the transaction of the caller. */
  abstract insert(promotion: Promotion, now: Date): Promise<void>;

  /** The promotion with this ID; `null` if it does not exist. */
  abstract find(id: PromotionId): Promise<Promotion | null>;

  /** The promotions active at `at` in this channel, with their targets, by ID (ADR-0168). */
  abstract activeAt(at: Date, channel: PromotionChannel): Promise<Promotion[]>;

  /**
   * Writes the terms of a promotion, and its targets when they changed, and counts one more version. Every change
   * carries the version read, so two changes never cross without one failing.
   *
   * @throws VersionConflictError when the saved version is not the one read.
   */
  abstract save(promotion: Promotion, now: Date): Promise<void>;
}
