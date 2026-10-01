import {
  DomainError,
  type Id,
  InvalidValueError,
} from '../../../shared-kernel/index.js';
import type { WarehouseId } from './warehouse.js';

/** A variant of Catalog, known here only by its ID (ADR-0005). */
export type VariantId = Id<'Variant'>;
export type StockItemId = Id<'StockItem'>;
export type StockMovementId = Id<'StockMovement'>;

/** Most units one receipt or adjustment moves (ADR-0071, ADR-0127). */
export const MAX_STOCK_QUANTITY = 100_000;

/** Longest note of a movement (API_SPEC.md §13). */
export const MAX_NOTE_LENGTH = 500;

export type StockMovementType = 'RECEIPT' | 'ADJUSTMENT' | 'SALE' | 'RESTOCK';

export const STOCK_MOVEMENT_TYPES: readonly StockMovementType[] = [
  'RECEIPT',
  'ADJUSTMENT',
  'SALE',
  'RESTOCK',
];

/** The reasons of an adjustment (ADR-0069). */
export type AdjustmentReason =
  | 'PHYSICAL_COUNT'
  | 'DAMAGED'
  | 'LOSS_OR_THEFT'
  | 'INTERNAL_USE'
  | 'DATA_ENTRY_ERROR'
  | 'OTHER';

export const ADJUSTMENT_REASONS: readonly AdjustmentReason[] = [
  'PHYSICAL_COUNT',
  'DAMAGED',
  'LOSS_OR_THEFT',
  'INTERNAL_USE',
  'DATA_ENTRY_ERROR',
  'OTHER',
];

/** Every reason of a movement: those of an adjustment and those of a restock (ADR-0069). */
export type StockMovementReason =
  AdjustmentReason | 'ORDER_CANCELLED' | 'SHIPMENT_RETURNED';

export const STOCK_MOVEMENT_REASONS: readonly StockMovementReason[] = [
  ...ADJUSTMENT_REASONS,
  'ORDER_CANCELLED',
  'SHIPMENT_RETURNED',
];

/** Reasons that only take stock away (ADR-0069). */
const DECREASE_ONLY: ReadonlySet<AdjustmentReason> = new Set([
  'DAMAGED',
  'LOSS_OR_THEFT',
  'INTERNAL_USE',
]);

/** The stock of a variant in a warehouse (DATABASE.md §6.2). Available is `onHand - reserved` (BR-INV-01). */
export interface StockLevel {
  readonly id: StockItemId;
  readonly variantId: VariantId;
  readonly warehouseId: WarehouseId;
  readonly onHand: number;
  readonly reserved: number;
  readonly updatedAt: Date;
}

/** A line of the append-only ledger of a stock item (DATABASE.md §6.3, BR-INV-13). */
export interface StockMovement {
  readonly id: StockMovementId;
  readonly stockItemId: StockItemId;
  readonly type: StockMovementType;
  /** Signed. */
  readonly quantity: number;
  readonly onHandAfter: number;
  readonly reasonCode: StockMovementReason | null;
  readonly note: string | null;
  readonly orderId: string | null;
  readonly orderLineId: string | null;
  /** The staff member who moved it, or `null` for the system. */
  readonly actorId: string | null;
  readonly createdAt: Date;
}

/** A value the API answers as a validation error of one field. */
abstract class StockFieldError extends DomainError {
  readonly code = 'validation-error';
  readonly category = 'invalid';

  protected constructor(field: string, code: string, message: string) {
    super(`${field}: ${code}`, { errors: [{ field, code, message }] });
  }
}

/** DAMAGED, LOSS_OR_THEFT and INTERNAL_USE only take stock away (ADR-0069, BR-INV-11). */
export class AdjustmentDirectionError extends StockFieldError {
  constructor() {
    super(
      'quantity',
      'reasonDirection',
      'Con este motivo la cantidad debe ser negativa.',
    );
  }
}

/** An adjustment for OTHER says why in its note (ADR-0069, BR-INV-11). */
export class AdjustmentNoteRequiredError extends StockFieldError {
  constructor() {
    super('note', 'isNotEmpty', 'Es obligatoria con el motivo OTHER.');
  }
}

/**
 * An adjustment would leave `onHand` below `reserved` or zero (BR-INV-01), or a reservation cannot take some
 * of its lines (BR-INV-02). Answered 409 `insufficient-stock` with the variants that cannot be fulfilled in
 * `lines`, as API_SPEC.md §6.2 describes the type.
 */
export class InsufficientStockError extends DomainError {
  readonly code = 'insufficient-stock';
  readonly category = 'conflict';

  constructor(variantIds: readonly VariantId[]) {
    super('There is not enough stock for the change', {
      lines: variantIds.map((variantId) => ({ variantId, canFulfill: false })),
    });
  }
}

/** A note trimmed, and `null` when it says nothing. */
export function noteOf(note: string | null | undefined): string | null {
  const trimmed = note?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

/**
 * The units of a receipt: 1 to 100,000.
 *
 * @throws InvalidValueError for any other number.
 */
export function receiptQuantity(quantity: number): number {
  if (
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > MAX_STOCK_QUANTITY
  ) {
    throw new InvalidValueError(
      `A receipt brings 1 to ${MAX_STOCK_QUANTITY} units`,
    );
  }
  return quantity;
}

/**
 * Checks an adjustment (UC-INV-03, ADR-0069): a signed quantity of 1 to 100,000 units, in the direction its
 * reason allows, and a note for OTHER. Whether the stock allows it is checked when it is applied.
 *
 * @throws InvalidValueError for a quantity of 0 or more than 100,000 units.
 * @throws AdjustmentDirectionError when the reason only takes stock away and the quantity adds.
 * @throws AdjustmentNoteRequiredError for OTHER without a note.
 */
export function checkAdjustment(adjustment: {
  quantity: number;
  reasonCode: AdjustmentReason;
  note: string | null;
}): void {
  const { quantity, reasonCode, note } = adjustment;
  if (
    !Number.isInteger(quantity) ||
    quantity === 0 ||
    Math.abs(quantity) > MAX_STOCK_QUANTITY
  ) {
    throw new InvalidValueError(
      `An adjustment moves 1 to ${MAX_STOCK_QUANTITY} units, up or down`,
    );
  }
  if (DECREASE_ONLY.has(reasonCode) && quantity > 0) {
    throw new AdjustmentDirectionError();
  }
  if (reasonCode === 'OTHER' && note === null) {
    throw new AdjustmentNoteRequiredError();
  }
}
