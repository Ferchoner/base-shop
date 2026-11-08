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

/**
 * Why stock goes to another warehouse (ADR-0172): to sell it there, to restock it, or another reason with a note;
 * `SHOW` for a loan, and `LOAN_RETURN` for what came back from one, which only the closing of a loan records.
 */
export type TransferReason =
  'SALE' | 'RESTOCK' | 'OTHER' | 'SHOW' | 'LOAN_RETURN';

export const TRANSFER_REASONS: readonly TransferReason[] = [
  'SALE',
  'RESTOCK',
  'OTHER',
  'SHOW',
  'LOAN_RETURN',
];

/** The reasons the staff gives: every one but `LOAN_RETURN`. */
export const REQUESTED_TRANSFER_REASONS: readonly TransferReason[] =
  TRANSFER_REASONS.filter((reason) => reason !== 'LOAN_RETURN');

/**
 * A transfer is `COMPLETED` when it is recorded; a loan is `OPEN` until it is `CLOSED`. Either is `CANCELLED` only
 * in its first minutes (ADR-0172).
 */
export type TransferStatus = 'COMPLETED' | 'CANCELLED' | 'OPEN' | 'CLOSED';

export const TRANSFER_STATUSES: readonly TransferStatus[] = [
  'COMPLETED',
  'CANCELLED',
  'OPEN',
  'CLOSED',
];

/** A transfer for good, or a loan to show the units, with a time to come back (ADR-0172). */
export type TransferKind = 'TRANSFER' | 'LOAN';

export const TRANSFER_KINDS: readonly TransferKind[] = ['TRANSFER', 'LOAN'];

/** A loan comes back from 5 minutes to 24 hours after it is recorded (ADR-0172). */
export const MIN_LOAN_MS = 5 * 60 * 1000;
export const MAX_LOAN_MS = 24 * 60 * 60 * 1000;

/** Most variants one transfer moves, so a transfer stays one short transaction. */
export const MAX_TRANSFER_LINES = 100;

/** How long after it is recorded a transfer can be cancelled (ADR-0172). */
export const TRANSFER_CANCEL_WINDOW_MS = 10 * 60 * 1000;

/** A variant of a transfer and its units. */
export interface TransferLine {
  readonly variantId: VariantId;
  readonly quantity: number;
}

/** A line of a transfer as it is kept: for a closed loan, also the units that came back. */
export interface StoredTransferLine extends TransferLine {
  /** Units of a loan line that came back when it was closed; `null` until then, and always in a transfer. */
  readonly returned: number | null;
}

/** What came back of a loan line when it is closed. */
export interface ReturnedLine {
  readonly variantId: VariantId;
  readonly returned: number;
}

export interface StockTransferSnapshot {
  readonly id: StockTransferId;
  /** The consecutive number of its folio, from the database; `null` until it is saved. */
  readonly number: number | null;
  readonly kind: TransferKind;
  readonly fromWarehouseId: WarehouseId;
  readonly toWarehouseId: WarehouseId;
  readonly reason: TransferReason;
  readonly note: string | null;
  readonly status: TransferStatus;
  readonly lines: readonly StoredTransferLine[];
  /** The staff member who recorded it. */
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly cancelledBy: string | null;
  readonly cancelledAt: Date | null;
  /** When a loan should come back; `null` in a transfer. */
  readonly returnBy: Date | null;
  readonly closedBy: string | null;
  readonly closedAt: Date | null;
  /** In the return of a loan, the loan. */
  readonly loanId: StockTransferId | null;
  /** In a closed loan, the transfer that brought back its units, if any came back. Read only. */
  readonly returnTransferId: StockTransferId | null;
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

  constructor(currentStatus: TransferStatus = 'COMPLETED') {
    super('A transfer can be cancelled only in its first 10 minutes', {
      currentStatus,
      reason: 'cancel-window-passed',
    });
  }
}

/** The prefix of the folio of each kind (ADR-0172). Both share one sequence, so a number names one of them. */
const PREFIXES: Readonly<Record<TransferKind, string>> = {
  TRANSFER: 'T-',
  LOAN: 'P-',
};

/** At least six digits, like the folios of work orders (ADR-0166). */
const MIN_DIGITS = 6;

/** The folio of a transfer, `T-` and its number with at least six digits, or of a loan, `P-`. */
export function formatTransferFolio(
  number: number,
  kind: TransferKind = 'TRANSFER',
): string {
  return `${PREFIXES[kind]}${String(number).padStart(MIN_DIGITS, '0')}`;
}

/**
 * The number of a folio as the staff types it: `T-000123`, `p-123`, `T123` or `123`; `null` for anything else. Up
 * to 15 digits, so the number stays exact in JavaScript.
 */
export function parseTransferFolio(text: string): number | null {
  const match = /^(?:[TP]-?)?([0-9]{1,15})$/i.exec(text.trim());
  return match === null ? null : Number(match[1]);
}

/**
 * Units moved from one warehouse to another in one step (T-163, ADR-0172): each line leaves the origin and enters
 * the destination when it is recorded. A transfer is never edited; it is cancelled only in its first 10 minutes,
 * and then its units go back to the origin. A loan (T-164) moves the units the same way to show them, with a time to
 * come back, and stays open until it is closed with the units that came back; those return with a transfer of their
 * own, `LOAN_RETURN`, which is never cancelled. Whether the warehouses and the stock allow it is checked when it is
 * applied.
 */
export class StockTransfer {
  private constructor(private state: StockTransferSnapshot) {}

  /**
   * A new transfer, done as it is recorded, or a new loan, open.
   *
   * @throws TransferFieldError when the warehouses are the same, a variant repeats, a line moves 0 or more than
   *   100,000 units, there are no lines or more than 100, OTHER has no note, the reason does not go with the kind
   *   (`SHOW` exactly with a loan, never `LOAN_RETURN`), or a loan comes back sooner than 5 minutes or later than
   *   24 hours, or a transfer has a time to come back.
   * @throws InvalidValueError for a note longer than 500 characters.
   */
  static record(input: {
    id: StockTransferId;
    kind?: TransferKind;
    fromWarehouseId: WarehouseId;
    toWarehouseId: WarehouseId;
    reason: TransferReason;
    note?: string | null;
    lines: readonly TransferLine[];
    returnBy?: Date | null;
    staffId: string;
    now: Date;
  }): StockTransfer {
    const kind = input.kind ?? 'TRANSFER';
    if (
      input.reason === 'LOAN_RETURN' ||
      (input.reason === 'SHOW') !== (kind === 'LOAN')
    ) {
      throw new TransferFieldError(
        'reason',
        'reasonKind',
        kind === 'LOAN'
          ? 'Un préstamo lleva el motivo SHOW.'
          : 'Un traslado lleva el motivo SALE, RESTOCK u OTHER.',
      );
    }
    const returnBy = input.returnBy ?? null;
    if (kind === 'LOAN') {
      const after =
        returnBy === null ? NaN : returnBy.getTime() - input.now.getTime();
      if (!(after >= MIN_LOAN_MS && after <= MAX_LOAN_MS)) {
        throw new TransferFieldError(
          'returnBy',
          'loanRange',
          'Debe ser de 5 minutos a 24 horas después de ahora.',
        );
      }
    } else if (returnBy !== null) {
      throw new TransferFieldError(
        'returnBy',
        'isEmpty',
        'Solo un préstamo tiene hora de regreso.',
      );
    }
    return StockTransfer.create({
      ...input,
      kind,
      returnBy,
      loanId: null,
    });
  }

  /**
   * The transfer that brings back what came back of a loan when it is closed: from the destination of the loan to
   * its origin, with the lines that came back, done as it is recorded and never cancelled.
   */
  static returnOf(
    loan: StockTransfer,
    input: { id: StockTransferId; staffId: string; now: Date },
  ): StockTransfer {
    const lines = loan.lines
      .filter(({ returned }) => (returned ?? 0) > 0)
      .map(({ variantId, returned }) => ({ variantId, quantity: returned! }));
    return StockTransfer.create({
      id: input.id,
      kind: 'TRANSFER',
      fromWarehouseId: loan.snapshot.toWarehouseId,
      toWarehouseId: loan.snapshot.fromWarehouseId,
      reason: 'LOAN_RETURN',
      note: null,
      lines,
      returnBy: null,
      loanId: loan.id,
      staffId: input.staffId,
      now: input.now,
    });
  }

  private static create(input: {
    id: StockTransferId;
    kind: TransferKind;
    fromWarehouseId: WarehouseId;
    toWarehouseId: WarehouseId;
    reason: TransferReason;
    note?: string | null;
    lines: readonly TransferLine[];
    returnBy: Date | null;
    loanId: StockTransferId | null;
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
      kind: input.kind,
      fromWarehouseId: input.fromWarehouseId,
      toWarehouseId: input.toWarehouseId,
      reason: input.reason,
      note,
      status: input.kind === 'LOAN' ? 'OPEN' : 'COMPLETED',
      lines: input.lines.map(({ variantId, quantity }) => ({
        variantId,
        quantity,
        returned: null,
      })),
      createdBy: input.staffId,
      createdAt: input.now,
      cancelledBy: null,
      cancelledAt: null,
      returnBy: input.returnBy,
      closedBy: null,
      closedAt: null,
      loanId: input.loanId,
      returnTransferId: null,
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

  get lines(): readonly StoredTransferLine[] {
    return this.state.lines;
  }

  /** Until when it can be cancelled: 10 minutes after it was recorded. */
  get cancellableUntil(): Date {
    return new Date(this.state.createdAt.getTime() + TRANSFER_CANCEL_WINDOW_MS);
  }

  /** Whether it can still be cancelled by its status: a transfer that is not the return of a loan, or an open loan. */
  get isCancellable(): boolean {
    return (
      (this.state.status === 'COMPLETED' && this.state.loanId === null) ||
      this.state.status === 'OPEN'
    );
  }

  /** An open loan whose time to come back passed. */
  isOverdue(now: Date): boolean {
    return (
      this.state.status === 'OPEN' &&
      this.state.returnBy !== null &&
      now.getTime() > this.state.returnBy.getTime()
    );
  }

  /**
   * Cancels it; the caller brings its units back to the origin in the same transaction.
   *
   * @throws InvalidStateTransitionError when it is already cancelled, it is a closed loan or the return of a loan.
   * @throws TransferCancelWindowError when more than 10 minutes passed since it was recorded.
   */
  cancel(staffId: string, now: Date): void {
    if (!this.isCancellable) {
      throw new InvalidStateTransitionError(this.state.status, 'cancel');
    }
    if (now.getTime() > this.cancellableUntil.getTime()) {
      throw new TransferCancelWindowError(this.state.status);
    }
    this.state = {
      ...this.state,
      status: 'CANCELLED',
      cancelledBy: staffId,
      cancelledAt: now,
    };
  }

  /**
   * Closes an open loan with the units of each line that came back; the caller brings them back with the transfer of
   * `returnOf`, when any came back, in the same transaction. The rest stays where it is.
   *
   * @throws InvalidStateTransitionError when it is not an open loan.
   * @throws TransferFieldError when the lines are not every line of the loan once (`loanLines`), or a line brings
   *   back fewer than 0 units or more than it took (`range`).
   */
  close(returned: readonly ReturnedLine[], staffId: string, now: Date): void {
    if (this.state.status !== 'OPEN') {
      throw new InvalidStateTransitionError(this.state.status, 'close');
    }
    const byVariant = new Map(
      this.state.lines.map((line) => [line.variantId, line]),
    );
    const seen = new Set<VariantId>();
    returned.forEach(({ variantId, returned: units }, i) => {
      const line = byVariant.get(variantId);
      if (line === undefined || seen.has(variantId)) {
        throw new TransferFieldError(
          `lines[${i}].variantId`,
          'loanLines',
          'Debe ser una línea del préstamo, una vez.',
        );
      }
      seen.add(variantId);
      if (!Number.isInteger(units) || units < 0 || units > line.quantity) {
        throw new TransferFieldError(
          `lines[${i}].returned`,
          'range',
          `Debe ser de 0 a ${line.quantity}.`,
        );
      }
    });
    if (seen.size !== byVariant.size) {
      throw new TransferFieldError(
        'lines',
        'loanLines',
        'Debe traer cada línea del préstamo.',
      );
    }
    const units = new Map(
      returned.map((line) => [line.variantId, line.returned]),
    );
    this.state = {
      ...this.state,
      status: 'CLOSED',
      closedBy: staffId,
      closedAt: now,
      lines: this.state.lines.map((line) => ({
        ...line,
        returned: units.get(line.variantId)!,
      })),
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
