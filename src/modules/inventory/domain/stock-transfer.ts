import {
  DomainError,
  type Id,
  InvalidStateTransitionError,
  InvalidValueError,
} from '../../../shared-kernel/index.js';
import {
  MAX_NOTE_LENGTH,
  MAX_STOCK_QUANTITY,
  noteOf,
  type VariantId,
} from './stock.js';
import type { WarehouseId } from './warehouse.js';

export type StockTransferId = Id<'StockTransfer'>;

/** Why stock goes to another warehouse (ADR-0172): to sell it there, to restock it, or another reason with a note. */
export type TransferReason = 'SALE' | 'RESTOCK' | 'OTHER';

export const TRANSFER_REASONS: readonly TransferReason[] = [
  'SALE',
  'RESTOCK',
  'OTHER',
];

/** A transfer is done when it is recorded, and cancelled only in its first minutes (ADR-0172). */
export type TransferStatus = 'COMPLETED' | 'CANCELLED';

export const TRANSFER_STATUSES: readonly TransferStatus[] = [
  'COMPLETED',
  'CANCELLED',
];

/** Most variants one transfer moves, so a transfer stays one short transaction. */
export const MAX_TRANSFER_LINES = 100;

/** How long after it is recorded a transfer can be cancelled (ADR-0172). */
export const TRANSFER_CANCEL_WINDOW_MS = 10 * 60 * 1000;

/** A variant of a transfer and its units. */
export interface TransferLine {
  readonly variantId: VariantId;
  readonly quantity: number;
}

export interface StockTransferSnapshot {
  readonly id: StockTransferId;
  /** The consecutive number of its folio, from the database; `null` until it is saved. */
  readonly number: number | null;
  readonly fromWarehouseId: WarehouseId;
  readonly toWarehouseId: WarehouseId;
  readonly reason: TransferReason;
  readonly note: string | null;
  readonly status: TransferStatus;
  readonly lines: readonly TransferLine[];
  /** The staff member who recorded it. */
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly cancelledBy: string | null;
  readonly cancelledAt: Date | null;
  readonly version: number;
}

/** A value of a transfer the API answers as a validation error of one field. */
export class TransferFieldError extends DomainError {
  readonly code = 'validation-error';
  readonly category = 'invalid';

  constructor(field: string, code: string, message: string) {
    super(`${field}: ${code}`, { errors: [{ field, code, message }] });
  }
}

/** A transfer can be cancelled only in the 10 minutes after it is recorded (ADR-0172). Answered 409. */
export class TransferCancelWindowError extends DomainError {
  readonly code = 'invalid-state-transition';
  readonly category = 'conflict';

  constructor() {
    super('A transfer can be cancelled only in its first 10 minutes', {
      currentStatus: 'COMPLETED',
      reason: 'cancel-window-passed',
    });
  }
}

/** The prefix of the folio of a transfer (ADR-0172). */
const PREFIX = 'T-';

/** At least six digits, like the folios of work orders (ADR-0166). */
const MIN_DIGITS = 6;

/** The folio of a transfer: its consecutive number with the prefix `T-` and at least six digits. */
export function formatTransferFolio(number: number): string {
  return `${PREFIX}${String(number).padStart(MIN_DIGITS, '0')}`;
}

/**
 * The number of a folio as the staff types it: `T-000123`, `t-123`, `T123` or `123`; `null` for anything else. Up
 * to 15 digits, so the number stays exact in JavaScript.
 */
export function parseTransferFolio(text: string): number | null {
  const match = /^(?:T-?)?([0-9]{1,15})$/i.exec(text.trim());
  return match === null ? null : Number(match[1]);
}

/**
 * Units moved from one warehouse to another in one step (T-163, ADR-0172): each line leaves the origin and enters
 * the destination when it is recorded. It is never edited; it is cancelled only in its first 10 minutes, and then
 * its units go back to the origin. Whether the warehouses and the stock allow it is checked when it is applied.
 */
export class StockTransfer {
  private constructor(private state: StockTransferSnapshot) {}

  /**
   * A new transfer, done as it is recorded.
   *
   * @throws TransferFieldError when the warehouses are the same, a variant repeats, a line moves 0 or more than
   *   100,000 units, there are no lines or more than 100, or OTHER has no note.
   * @throws InvalidValueError for a note longer than 500 characters.
   */
  static record(input: {
    id: StockTransferId;
    fromWarehouseId: WarehouseId;
    toWarehouseId: WarehouseId;
    reason: TransferReason;
    note?: string | null;
    lines: readonly TransferLine[];
    staffId: string;
    now: Date;
  }): StockTransfer {
    if (input.fromWarehouseId === input.toWarehouseId) {
      throw new TransferFieldError(
        'toWarehouseId',
        'differentWarehouse',
        'Debe ser otro almacén que el de origen.',
      );
    }
    const note = noteOf(input.note);
    if (note !== null && note.length > MAX_NOTE_LENGTH) {
      throw new InvalidValueError(
        `A note has at most ${MAX_NOTE_LENGTH} characters`,
      );
    }
    if (input.reason === 'OTHER' && note === null) {
      throw new TransferFieldError(
        'note',
        'isNotEmpty',
        'Es obligatoria con el motivo OTHER.',
      );
    }
    checkLines(input.lines);
    return new StockTransfer({
      id: input.id,
      number: null,
      fromWarehouseId: input.fromWarehouseId,
      toWarehouseId: input.toWarehouseId,
      reason: input.reason,
      note,
      status: 'COMPLETED',
      lines: input.lines.map(({ variantId, quantity }) => ({
        variantId,
        quantity,
      })),
      createdBy: input.staffId,
      createdAt: input.now,
      cancelledBy: null,
      cancelledAt: null,
      version: 1,
    });
  }

  static restore(snapshot: StockTransferSnapshot): StockTransfer {
    return new StockTransfer(snapshot);
  }

  get snapshot(): StockTransferSnapshot {
    return this.state;
  }

  get id(): StockTransferId {
    return this.state.id;
  }

  get version(): number {
    return this.state.version;
  }

  get lines(): readonly TransferLine[] {
    return this.state.lines;
  }

  /** Until when it can be cancelled: 10 minutes after it was recorded. */
  get cancellableUntil(): Date {
    return new Date(this.state.createdAt.getTime() + TRANSFER_CANCEL_WINDOW_MS);
  }

  /**
   * Cancels it; the caller brings its units back to the origin in the same transaction.
   *
   * @throws InvalidStateTransitionError when it is already cancelled.
   * @throws TransferCancelWindowError when more than 10 minutes passed since it was recorded.
   */
  cancel(staffId: string, now: Date): void {
    if (this.state.status !== 'COMPLETED') {
      throw new InvalidStateTransitionError(this.state.status, 'cancel');
    }
    if (now.getTime() > this.cancellableUntil.getTime()) {
      throw new TransferCancelWindowError();
    }
    this.state = {
      ...this.state,
      status: 'CANCELLED',
      cancelledBy: staffId,
      cancelledAt: now,
    };
  }
}

function checkLines(lines: readonly TransferLine[]): void {
  if (lines.length === 0 || lines.length > MAX_TRANSFER_LINES) {
    throw new TransferFieldError(
      'lines',
      'arrayLength',
      `Debe tener de 1 a ${MAX_TRANSFER_LINES} líneas.`,
    );
  }
  const seen = new Set<VariantId>();
  lines.forEach(({ variantId, quantity }, i) => {
    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > MAX_STOCK_QUANTITY
    ) {
      throw new TransferFieldError(
        `lines[${i}].quantity`,
        'range',
        `Debe ser de 1 a ${MAX_STOCK_QUANTITY.toLocaleString('en-US')}.`,
      );
    }
    if (seen.has(variantId)) {
      throw new TransferFieldError(
        `lines[${i}].variantId`,
        'duplicateVariant',
        'Cada variante va una vez por traslado.',
      );
    }
    seen.add(variantId);
  });
}
