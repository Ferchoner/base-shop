import type { StockMovementId, VariantId } from './stock.js';
import type {
  CountOutcome,
  OpenCountLine,
  StockCount,
  StockCountId,
} from './stock-count.js';

/** A line taken for a sheet: its variant and the location of its stock item then. */
export interface NewCountLine {
  readonly variantId: VariantId;
  readonly location: string | null;
}

/** What was counted of a line, with the units on hand at that moment. */
export interface CountCapture {
  readonly counted: number;
  readonly expected: number;
  readonly countedBy: string;
  readonly countedAt: Date;
}

/** What applying a sheet did with one of its lines. */
export interface LineOutcome {
  readonly variantId: VariantId;
  readonly outcome: CountOutcome;
  readonly movementId: StockMovementId | null;
}

/**
 * Persistence of count sheets (DATABASE.md §6.8, ADR-0173), always in the transaction of the caller. A variant is in
 * one open sheet per warehouse; the partial unique index of the lines backs it, and the methods that add lines
 * answer the variants that are already in another one instead of failing. An abstract class rather than an
 * interface, so it can be the dependency injection token without depending on NestJS.
 */
export abstract class StockCountRepository {
  /**
   * Saves a new sheet with its lines, numbered from 1 in their order, and answers the number of its folio. When
   * some of their variants are in another open sheet of the warehouse it answers those instead, with the other
   * lines saved, and the caller rolls the transaction back.
   */
  abstract insert(
    count: StockCount,
    lines: readonly NewCountLine[],
  ): Promise<{ number: number } | { conflicts: OpenCountLine[] }>;

  /** The sheet with this ID, its row locked until the transaction ends; `null` if it does not exist. */
  abstract lock(id: StockCountId): Promise<StockCount | null>;

  /** Whether the sheet has a line of this variant. */
  abstract hasLine(id: StockCountId, variantId: VariantId): Promise<boolean>;

  /**
   * Adds a line at the end of an open sheet, when the variant is not in another open sheet of its warehouse; the
   * sheet that has it otherwise.
   */
  abstract addLine(
    count: StockCount,
    line: NewCountLine,
  ): Promise<OpenCountLine | null>;

  /** Writes what was counted of a line, and takes back a recount asked. */
  abstract capture(
    id: StockCountId,
    variantId: VariantId,
    capture: CountCapture,
  ): Promise<void>;

  /** Clears what was counted of a line and marks it to count again. */
  abstract recount(id: StockCountId, variantId: VariantId): Promise<void>;

  /**
   * The units on hand of a variant in the warehouse of a sheet now, and its location; 0 and `null` without a
   * stock item.
   */
  abstract stockOf(
    count: StockCount,
    variantId: VariantId,
  ): Promise<{ onHand: number; location: string | null }>;

  /** The counted lines of a sheet, with the difference to adjust, for applying it. */
  abstract countedLines(id: StockCountId): Promise<
    {
      variantId: VariantId;
      difference: number;
    }[]
  >;

  /**
   * Closes every line of a sheet that is no longer open: the outcome of each one given, and NOT_COUNTED for the
   * rest when it is applied, which it answers how many; or none when it is cancelled (`null`), and 0.
   */
  abstract closeLines(
    id: StockCountId,
    outcomes: readonly LineOutcome[] | null,
  ): Promise<number>;

  /**
   * Writes the status of a sheet and counts one more version, only over the version it read; a change of a line
   * saves the sheet too, so each one counts a version.
   *
   * @throws VersionConflictError when the saved version is not the one read.
   */
  abstract save(count: StockCount, now: Date): Promise<void>;
}
