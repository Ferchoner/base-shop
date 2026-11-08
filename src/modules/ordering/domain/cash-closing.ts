import {
  type Id,
  InvalidValueError,
  MAX_MONEY_AMOUNT,
} from '../../../shared-kernel/index.js';
import type { StaffId, WarehouseId } from './order.js';

export type CashClosingId = Id<'CashClosing'>;

/** How the store collects a payment, as the cash closing groups them (ADR-0161, ADR-0171). */
export const COLLECTION_METHODS = [
  'CASH',
  'CARD_TERMINAL',
  'TRANSFER',
] as const;

export type CollectionMethod = (typeof COLLECTION_METHODS)[number];

/** Characters of the note of a cash closing, at most, like the note of a manual payment (ADR-0163, ADR-0171). */
export const MAX_CASH_CLOSING_NOTE_LENGTH = 500;

/** What was collected with one method, or without one, in a day (ADR-0171). Amounts in cents. */
export interface MethodTotal {
  /** `null` for the payments without a method: of a provider, or when the staff did not say. */
  readonly method: CollectionMethod | null;
  readonly count: number;
  readonly amount: number;
}

/** What a staff member registered in a day (ADR-0171). Amounts in cents. */
export interface StaffTotal {
  /** `null` for the payments and refunds no staff member registered, such as those of a provider. */
  readonly staffId: StaffId | null;
  readonly paymentCount: number;
  readonly paymentAmount: number;
  readonly cashAmount: number;
  readonly refundAmount: number;
}

/**
 * The figures of the cash of a warehouse in a day of central Mexico (ADR-0171): its store orders, the money that came
 * in and went out, and the lines sold at an open price. Amounts in cents with VAT; `expectedCash` may be negative when
 * the cash given back is more than the cash collected.
 */
export interface CashDay {
  /** The store orders placed that day, and their total. */
  readonly placedCount: number;
  readonly placedAmount: number;
  /** Of those, the ones still waiting for their payment: sold but not collected. */
  readonly pendingPaymentCount: number;
  /** The store orders cancelled that day, whenever they were placed. */
  readonly cancelledCount: number;
  /** The payments captured that day, by method: cash, card terminal, transfer and without method, always the four. */
  readonly payments: readonly MethodTotal[];
  readonly paymentAmount: number;
  /** The refunds completed that day, and those of cash payments. */
  readonly refundCount: number;
  readonly refundAmount: number;
  readonly cashRefundAmount: number;
  /** Cash collected less cash given back. */
  readonly expectedCash: number;
  /** By the staff member who registered each payment or refund. */
  readonly byStaff: readonly StaffTotal[];
  /** The lines sold at an open price in the orders placed that day that were not cancelled, refunded nor expired. */
  readonly openPriceLineCount: number;
  readonly openPriceAmount: number;
}

export interface CashClosingSnapshot {
  readonly id: CashClosingId;
  readonly warehouseId: WarehouseId;
  /** The day of central Mexico, `YYYY-MM-DD`. */
  readonly date: string;
  readonly summary: CashDay;
  readonly expectedCash: number;
  readonly countedCash: number;
  /** Counted less expected: negative when cash is missing. */
  readonly difference: number;
  readonly note: string | null;
  readonly closedBy: StaffId;
  readonly closedAt: Date;
}

/**
 * The closing of the cash of a warehouse for a day (ADR-0171): what the summary said then, the cash the staff counted
 * and the difference. A note says why whenever they differ. It is never edited nor deleted; what comes after it shows
 * in the summary of the day as after the closing.
 */
export class CashClosing {
  private constructor(private readonly state: CashClosingSnapshot) {}

  /**
   * @throws InvalidValueError for a counted cash out of 0 to the largest amount, or a note over 500 characters;
   *   CashClosingNoteRequiredError when the counted cash differs from the expected one without a note.
   */
  static close(input: {
    id: CashClosingId;
    warehouseId: WarehouseId;
    date: string;
    summary: CashDay;
    countedCash: number;
    note: string | null;
    closedBy: StaffId;
    now: Date;
  }): CashClosing {
    if (
      !Number.isInteger(input.countedCash) ||
      input.countedCash < 0 ||
      input.countedCash > MAX_MONEY_AMOUNT
    ) {
      throw new InvalidValueError(
        `Counted cash is from 0 to ${MAX_MONEY_AMOUNT} cents`,
      );
    }
    const note = input.note?.trim() || null;
    if (note !== null && note.length > MAX_CASH_CLOSING_NOTE_LENGTH) {
      throw new InvalidValueError(
        `A note has at most ${MAX_CASH_CLOSING_NOTE_LENGTH} characters`,
      );
    }
    const difference = input.countedCash - input.summary.expectedCash;
    if (difference !== 0 && note === null) {
      throw new CashClosingNoteRequiredError();
    }
    return new CashClosing({
      id: input.id,
      warehouseId: input.warehouseId,
      date: input.date,
      summary: input.summary,
      expectedCash: input.summary.expectedCash,
      countedCash: input.countedCash,
      difference,
      note,
      closedBy: input.closedBy,
      closedAt: input.now,
    });
  }

  static restore(snapshot: CashClosingSnapshot): CashClosing {
    return new CashClosing(snapshot);
  }

  get id(): CashClosingId {
    return this.state.id;
  }

  get snapshot(): CashClosingSnapshot {
    return this.state;
  }
}

/** The counted cash differs from the expected one and the closing says nothing of why (ADR-0171). Answered 400. */
export class CashClosingNoteRequiredError extends InvalidValueError {
  constructor() {
    super('A closing with a difference needs a note', {
      errors: [
        {
          field: 'note',
          code: 'requiredWithDifference',
          message: 'El efectivo contado no es el esperado: escribe por qué.',
        },
      ],
    });
  }
}
