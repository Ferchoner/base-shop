/** Lines an order of the staff has at most: the variants a cart takes (BR-CRT-12, ADR-0161). */
export const MAX_STAFF_ORDER_LINES = 100;

/** Units a line of an order has at most, as a line of a cart (BR-CRT-02) and `order_lines` hold. */
export const MAX_ORDER_LINE_QUANTITY = 30;

/** The price the staff types on a line at an open price, in cents with VAT, at most: $100,000.00 (ADR-0171). */
export const MAX_OPEN_UNIT_PRICE = 10_000_000;

/** Characters of what was sold on a line at an open price, at most (ADR-0171), as `order_lines` holds. */
export const MAX_OPEN_PRICE_NOTE_LENGTH = 200;
