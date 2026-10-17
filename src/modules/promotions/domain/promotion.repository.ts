import type { Promotion, PromotionChannel, PromotionId } from './promotion.js';

/**
 * Persistence of promotions (DATABASE.md §18). An abstract class rather than an interface, so it can be the
 * dependency injection token without depending on NestJS.
 */
export abstract class PromotionRepository {
  /**
   * Saves a new promotion with its targets, in the transaction of the caller.
   *
   * @throws DuplicateValueError on `code` when another promotion has the code (ADR-0168).
   */
  abstract insert(promotion: Promotion, now: Date): Promise<void>;

  /** The promotion with this ID; `null` if it does not exist. */
  abstract find(id: PromotionId): Promise<Promotion | null>;

  /** The coupon with this code, kept in uppercase, whatever its status; `null` if no promotion has it (ADR-0168). */
  abstract findByCode(code: string): Promise<Promotion | null>;

  /** The automatic promotions active at `at` in this channel, with their targets, by ID: never a coupon (ADR-0168). */
  abstract activeAt(at: Date, channel: PromotionChannel): Promise<Promotion[]>;

  /**
   * Writes the terms of a promotion, and its targets when they changed, and counts one more version. Every change
   * carries the version read, so two changes never cross without one failing. It never writes the uses of a coupon,
   * which are counted apart.
   *
   * @throws VersionConflictError when the saved version is not the one read; DuplicateValueError on `code`.
   */
  abstract save(promotion: Promotion, now: Date): Promise<void>;

  /**
   * Counts one more use of a coupon, in the transaction of the caller, locking its row until it ends so two orders
   * never take the last use (ADR-0168). Within its limit only, unless `beyondLimit`: a late payment counts its use
   * again even past it.
   *
   * @returns whether it counted it: false when it has no uses left.
   */
  abstract addUse(
    id: PromotionId,
    options: { readonly beyondLimit: boolean },
  ): Promise<boolean>;

  /** Gives back a use of a coupon, never below none, locking its row as `addUse`. */
  abstract removeUse(id: PromotionId): Promise<void>;
}
