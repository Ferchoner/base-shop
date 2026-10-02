import { type Id, InvalidValueError } from '../../../shared-kernel/index.js';
import {
  CartLineLimitError,
  CartNotActiveError,
  LineQuantityError,
} from './cart-errors.js';

export type CartId = Id<'Cart'>;

/** A customer of Identity, known here only by its ID (ADR-0005). */
export type CustomerId = Id<'User'>;

/** A variant of Catalog, known here only by its ID (ADR-0005). */
export type VariantId = Id<'Variant'>;

/**
 * ACTIVE carts change; a cart used by an order is CHECKED_OUT, and a cart whose lines went into another one is
 * MERGED: a guest cart merged into a customer's, or the cart of an expired order (ADR-0137).
 */
export type CartStatus = 'ACTIVE' | 'CHECKED_OUT' | 'MERGED';

/** Units a line holds at most (BR-CRT-02). */
export const MAX_LINE_QUANTITY = 30;

/** Different variants a cart holds at most (ADR-0131): every view reads each of them in three contexts. */
export const MAX_CART_LINES = 100;

/** Units of a variant that go into a cart, such as a line of an order. */
export interface CartItem {
  readonly variantId: VariantId;
  readonly quantity: number;
}

/** A line of a cart: one per variant (BR-CRT-01). */
export interface CartLine {
  readonly variantId: VariantId;
  readonly quantity: number;
  /** When it was added: the cart shows its lines in that order. */
  readonly addedAt: Date;
}

function assertQuantity(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new InvalidValueError(
      'A line holds a whole number of units above zero',
    );
  }
  if (quantity > MAX_LINE_QUANTITY) {
    throw new LineQuantityError(MAX_LINE_QUANTITY);
  }
}

/**
 * The cart of a guest or a customer (DOMAIN_MODEL.md, Shopping). It keeps only variants and quantities, never
 * prices (BR-CRT-04), and only an active cart changes (BR-CRT-03). Its ID is a random UUID, because it is the
 * only credential of a guest cart (ADR-0059).
 */
export class Cart {
  private readonly lineMap: Map<VariantId, CartLine>;
  /** Variants whose line was added, changed or removed since the cart was read. */
  private readonly touched = new Set<VariantId>();
  private changed = false;

  private constructor(
    readonly id: CartId,
    private owner: CustomerId | null,
    private state: CartStatus,
    private mergedInto: CartId | null,
    private activityAt: Date,
    readonly version: number,
    lines: readonly CartLine[],
  ) {
    this.lineMap = new Map(lines.map((line) => [line.variantId, line]));
  }

  /** A new empty cart of a guest, or of a customer. */
  static open(id: CartId, owner: CustomerId | null, now: Date): Cart {
    const cart = new Cart(id, owner, 'ACTIVE', null, now, 1, []);
    cart.changed = true;
    return cart;
  }

  /** A cart as it was saved. */
  static restore(cart: {
    id: CartId;
    ownerId: CustomerId | null;
    status: CartStatus;
    mergedIntoCartId: CartId | null;
    lastActivityAt: Date;
    version: number;
    lines: readonly CartLine[];
  }): Cart {
    return new Cart(
      cart.id,
      cart.ownerId,
      cart.status,
      cart.mergedIntoCartId,
      cart.lastActivityAt,
      cart.version,
      cart.lines,
    );
  }

  get ownerId(): CustomerId | null {
    return this.owner;
  }

  get status(): CartStatus {
    return this.state;
  }

  get mergedIntoCartId(): CartId | null {
    return this.mergedInto;
  }

  /** The last change, the base of the 30-day cleanup of guest carts (BR-CRT-06); reading never counts. */
  get lastActivityAt(): Date {
    return this.activityAt;
  }

  /** Oldest first. */
  get lines(): CartLine[] {
    return [...this.lineMap.values()].sort(
      (a, b) =>
        a.addedAt.getTime() - b.addedAt.getTime() ||
        a.variantId.localeCompare(b.variantId),
    );
  }

  line(variantId: VariantId): CartLine | undefined {
    return this.lineMap.get(variantId);
  }

  /** Whether anything changed since it was read, so there is something to save. */
  get hasChanges(): boolean {
    return this.changed;
  }

  /** The variants whose line the repository must write or delete. */
  get touchedVariants(): VariantId[] {
    return [...this.touched];
  }

  /**
   * Adds units of a variant: to its line if there is one (BR-CRT-01), up to 30 (BR-CRT-02), or in a new line
   * while the cart has fewer than MAX_CART_LINES.
   *
   * @throws CartNotActiveError, LineQuantityError or CartLineLimitError.
   */
  add(variantId: VariantId, quantity: number, now: Date): void {
    this.assertActive();
    const current = this.lineMap.get(variantId);
    if (current === undefined && this.lineMap.size >= MAX_CART_LINES) {
      throw new CartLineLimitError(MAX_CART_LINES);
    }
    assertQuantity(quantity);
    assertQuantity((current?.quantity ?? 0) + quantity);
    this.put(variantId, (current?.quantity ?? 0) + quantity, now);
  }

  /**
   * Sets the units of a line that the cart has.
   *
   * @returns false when the cart has no line of that variant.
   * @throws CartNotActiveError or LineQuantityError.
   */
  change(variantId: VariantId, quantity: number, now: Date): boolean {
    this.assertActive();
    assertQuantity(quantity);
    const current = this.lineMap.get(variantId);
    if (current === undefined) return false;
    if (current.quantity !== quantity) this.put(variantId, quantity, now);
    return true;
  }

  /**
   * Removes the line of a variant; removing one the cart does not have changes nothing.
   *
   * @throws CartNotActiveError.
   */
  remove(variantId: VariantId, now: Date): void {
    this.assertActive();
    if (!this.lineMap.delete(variantId)) return;
    this.touched.add(variantId);
    this.touch(now);
  }

  /**
   * Adds the lines of a guest cart to this customer's cart, up to 30 units per line without notice (BR-CRT-05),
   * and leaves the guest cart MERGED into this one, so its ID no longer changes anything (ADR-0059). The lines
   * the guest cart brings may exceed MAX_CART_LINES: a merge never drops what the customer chose.
   *
   * @throws CartNotActiveError when either cart is not active.
   */
  absorb(guest: Cart, now: Date): void {
    this.assertActive();
    guest.assertActive();
    this.addCapped(guest.lines, now);
    guest.state = 'MERGED';
    guest.mergedInto = this.id;
    guest.touch(now);
    this.touch(now);
  }

  /**
   * The order this cart was checked out for expired, and its customer has no other active cart (UC-CRT-08,
   * ADR-0054): the cart is ACTIVE again, with the lines it was checked out with, which never changed since.
   *
   * @returns false, changing nothing, unless the cart is CHECKED_OUT.
   */
  reactivate(now: Date): boolean {
    if (this.state !== 'CHECKED_OUT') return false;
    this.state = 'ACTIVE';
    this.touch(now);
    return true;
  }

  /**
   * The lines of an expired order go into this active cart of its customer, up to 30 units per line without
   * notice, as in a merge (BR-CRT-10, ADR-0054), and the cart the order came from becomes MERGED into this one.
   * Like a merge, it may pass MAX_CART_LINES and it keeps lines that stopped being sellable (ADR-0137).
   *
   * @returns false, changing nothing, unless the cart of the order is CHECKED_OUT.
   * @throws CartNotActiveError when this cart is not active.
   */
  absorbOrder(source: Cart, items: readonly CartItem[], now: Date): boolean {
    this.assertActive();
    if (source.state !== 'CHECKED_OUT') return false;
    this.addCapped(items, now);
    source.state = 'MERGED';
    source.mergedInto = this.id;
    source.touch(now);
    this.touch(now);
    return true;
  }

  /**
   * The guest cart becomes the customer's, with its lines as they are, when the customer has no active cart
   * (ADR-0059).
   *
   * @throws CartNotActiveError.
   */
  adoptBy(customer: CustomerId, now: Date): void {
    this.assertActive();
    this.owner = customer;
    this.touch(now);
  }

  /**
   * Leaves the cart CHECKED_OUT, used by an order: it no longer changes, and the customer's next line opens a
   * new cart (BR-CRT-03). The checkout does it in the transaction that creates the order (ADR-0019).
   *
   * @throws CartNotActiveError.
   */
  checkOut(now: Date): void {
    this.assertActive();
    this.state = 'CHECKED_OUT';
    this.touch(now);
  }

  /**
   * The lines of a cancelled or refunded order go into this cart, to buy them again (UC-CRT-09, BR-CRT-11): up to
   * 30 units per line without notice and, like a merge, past MAX_CART_LINES if they must (ADR-0139).
   *
   * @throws CartNotActiveError.
   */
  copyOrderLines(items: readonly CartItem[], now: Date): void {
    this.assertActive();
    this.addCapped(items, now);
    this.touch(now);
  }

  /**
   * The staff buys again a guest order in the cart it came from, still CHECKED_OUT (UC-CRT-09, ADR-0082,
   * ADR-0139): the cart is ACTIVE again with the items given, the lines of the order that are still sold, up to
   * 30 units each, instead of those it was checked out with.
   *
   * @throws CartNotActiveError unless the cart is CHECKED_OUT.
   */
  reopenWith(items: readonly CartItem[], now: Date): void {
    if (this.state !== 'CHECKED_OUT') throw new CartNotActiveError(this.state);
    const kept = new Map(
      items.map(({ variantId, quantity }) => [
        variantId,
        Math.min(quantity, MAX_LINE_QUANTITY),
      ]),
    );
    // A Map allows deleting the entry it is on while it is iterated.
    for (const variantId of this.lineMap.keys()) {
      if (kept.has(variantId)) continue;
      this.lineMap.delete(variantId);
      this.touched.add(variantId);
    }
    for (const [variantId, quantity] of kept) {
      if (this.lineMap.get(variantId)?.quantity !== quantity) {
        this.put(variantId, quantity, now);
      }
    }
    this.state = 'ACTIVE';
    this.touch(now);
  }

  /** Adds the items to their lines, up to 30 units each and without notice (BR-CRT-05, BR-CRT-10). */
  private addCapped(items: readonly CartItem[], now: Date): void {
    for (const item of items) {
      const current = this.lineMap.get(item.variantId)?.quantity ?? 0;
      const quantity = Math.min(current + item.quantity, MAX_LINE_QUANTITY);
      if (quantity !== current) this.put(item.variantId, quantity, now);
    }
  }

  private put(variantId: VariantId, quantity: number, now: Date): void {
    const current = this.lineMap.get(variantId);
    this.lineMap.set(variantId, {
      variantId,
      quantity,
      addedAt: current?.addedAt ?? now,
    });
    this.touched.add(variantId);
    this.touch(now);
  }

  private touch(now: Date): void {
    this.activityAt = now;
    this.changed = true;
  }

  private assertActive(): void {
    if (this.state !== 'ACTIVE') throw new CartNotActiveError(this.state);
  }
}
