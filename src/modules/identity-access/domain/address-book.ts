import {
  DomainError,
  type Id,
  InvalidValueError,
  NotFoundError,
} from '../../../shared-kernel/index.js';
import type { UserId } from './user.js';

export type AddressId = Id<'Address'>;

/** What a customer writes in an address (ADR-0057, API_SPEC.md §8.2). */
export interface AddressFields {
  readonly recipientName: string;
  /** Exactly 10 digits. */
  readonly phone: string;
  readonly street: string;
  readonly exteriorNumber: string;
  readonly interiorNumber: string | null;
  readonly neighborhood: string;
  /** 5 digits; only the format is checked (BR-ADR-05). */
  readonly postalCode: string;
  readonly stateCode: string;
  readonly municipalityCode: string;
  readonly city: string | null;
  readonly references: string | null;
}

export interface Address extends AddressFields {
  readonly id: AddressId;
  readonly isDefault: boolean;
  readonly createdAt: Date;
}

/** The customer already keeps the most addresses allowed (BR-ADR-04, E-28). */
export class AddressLimitReachedError extends DomainError {
  readonly code = 'address-limit-reached';
  readonly category = 'conflict';

  constructor(limit: number) {
    super(`A customer keeps at most ${limit} addresses`, { limit });
  }
}

const PHONE = /^[0-9]{10}$/;
const POSTAL_CODE = /^[0-9]{5}$/;

function checkFormats(fields: Partial<AddressFields>): void {
  if (fields.phone !== undefined && !PHONE.test(fields.phone)) {
    throw new InvalidValueError('A phone has exactly 10 digits');
  }
  if (fields.postalCode !== undefined && !POSTAL_CODE.test(fields.postalCode)) {
    throw new InvalidValueError('A postal code has 5 digits');
  }
}

/**
 * The address book of a customer (UC-IAM-11, ADR-0113): at most `limit` addresses, and at most one default.
 * The first address becomes the default; making another one the default unmarks the previous one; removing
 * the default leaves none. It is loaded with the customer row locked, so concurrent changes to the same book
 * run one after the other. Where each municipality is checked against the geographic catalog is up to the
 * use cases (BR-ADR-02).
 */
export class AddressBook {
  private readonly changed = new Set<AddressId>();
  private readonly removed = new Set<AddressId>();

  private constructor(
    readonly customerId: UserId,
    private items: Address[],
    private readonly limit: number,
  ) {}

  static restore(
    customerId: UserId,
    addresses: readonly Address[],
    limit: number,
  ): AddressBook {
    return new AddressBook(customerId, [...addresses], limit);
  }

  get addresses(): readonly Address[] {
    return this.items;
  }

  /** Addresses created or modified since the book was loaded. */
  get changedIds(): ReadonlySet<AddressId> {
    return this.changed;
  }

  get removedIds(): ReadonlySet<AddressId> {
    return this.removed;
  }

  find(id: AddressId): Address {
    const address = this.items.find((item) => item.id === id);
    if (address === undefined) throw new NotFoundError('Address', id);
    return address;
  }

  add(
    id: AddressId,
    fields: AddressFields,
    options: { makeDefault: boolean; now: Date },
  ): Address {
    if (this.items.length >= this.limit) {
      throw new AddressLimitReachedError(this.limit);
    }
    checkFormats(fields);
    const isDefault = this.items.length === 0 || options.makeDefault;
    if (isDefault) this.unmarkDefault();
    const address: Address = {
      ...fields,
      id,
      isDefault,
      createdAt: options.now,
    };
    this.items.push(address);
    this.changed.add(id);
    return address;
  }

  /**
   * Changes the given fields. `makeDefault: true` makes it the default and unmarks the previous one;
   * `false` unmarks it, leaving no default (ADR-0113).
   */
  update(
    id: AddressId,
    changes: Partial<AddressFields>,
    makeDefault?: boolean,
  ): Address {
    const current = this.find(id);
    checkFormats(changes);
    if (makeDefault === true && !current.isDefault) this.unmarkDefault();
    const updated: Address = {
      ...current,
      ...changes,
      isDefault: makeDefault ?? current.isDefault,
    };
    this.items = this.items.map((item) => (item.id === id ? updated : item));
    this.changed.add(id);
    return updated;
  }

  /** Removes an address; if it was the default, no address is the default any more (ADR-0071). */
  remove(id: AddressId): void {
    this.find(id);
    this.items = this.items.filter((item) => item.id !== id);
    this.changed.delete(id);
    this.removed.add(id);
  }

  private unmarkDefault(): void {
    this.items = this.items.map((item) => {
      if (!item.isDefault) return item;
      this.changed.add(item.id);
      return { ...item, isDefault: false };
    });
  }
}
