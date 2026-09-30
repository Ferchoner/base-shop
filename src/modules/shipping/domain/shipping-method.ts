import {
  DomainError,
  type Id,
  InvalidValueError,
  type Money,
} from '../../../shared-kernel/index.js';

export type ShippingMethodId = Id<'ShippingMethod'>;

/** Longest name of a shipping method (ADR-0122). Only the staff sees it (ADR-0092). */
export const MAX_NAME_LENGTH = 100;

/** Longest estimated delivery time, in business days (ADR-0083, ADR-0122). */
export const MAX_DELIVERY_BUSINESS_DAYS = 30;

/** What the administrator configures (UC-SHI-02, ADR-0042, ADR-0075, ADR-0083). */
export interface ShippingMethodSettings {
  readonly name: string;
  /** VAT included (ADR-0079). Zero means shipping is always free. */
  readonly flatFee: Money;
  /** `null`: the flat fee is always charged. */
  readonly freeShippingThreshold: Money | null;
  readonly deliveryMinBusinessDays: number;
  readonly deliveryMaxBusinessDays: number;
}

export interface ShippingMethodSnapshot extends ShippingMethodSettings {
  readonly id: ShippingMethodId;
  readonly isActive: boolean;
  readonly version: number;
}

/**
 * The estimated delivery time is a range: its maximum cannot be below its minimum (ADR-0083). Answered as a
 * validation error of `deliveryMaxBusinessDays`.
 */
export class DeliveryRangeError extends DomainError {
  readonly code = 'validation-error';
  readonly category = 'invalid';

  constructor() {
    super('The longest delivery time is below the shortest', {
      errors: [
        {
          field: 'deliveryMaxBusinessDays',
          code: 'deliveryRange',
          message: 'Debe ser mayor o igual que deliveryMinBusinessDays.',
        },
      ],
    });
  }
}

/**
 * The shipping method (DATABASE.md §10.1): a flat fee per order with VAT included, free shipping from a
 * minimum amount and an estimated delivery time (ADR-0042, ADR-0079, ADR-0083). The MVP has one, created
 * by a migration with the values of ADR-0092; the administrator changes them with optimistic locking.
 */
export class ShippingMethod {
  private constructor(private state: ShippingMethodSnapshot) {}

  static restore(snapshot: ShippingMethodSnapshot): ShippingMethod {
    return new ShippingMethod(snapshot);
  }

  get id(): ShippingMethodId {
    return this.state.id;
  }

  get version(): number {
    return this.state.version;
  }

  /**
   * Replaces every setting (UC-SHI-02). Placed orders keep what they applied (ADR-0042).
   *
   * @throws InvalidValueError or DeliveryRangeError.
   */
  configure(settings: ShippingMethodSettings): void {
    this.state = { ...this.state, ...validSettings(settings) };
  }

  /** Called by the repository once a change is saved. */
  markSaved(version: number): void {
    this.state = { ...this.state, version };
  }

  snapshot(): ShippingMethodSnapshot {
    return this.state;
  }
}

function validSettings(
  settings: ShippingMethodSettings,
): ShippingMethodSettings {
  const name = settings.name.trim();
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) {
    throw new InvalidValueError(
      `A shipping method name has 1 to ${MAX_NAME_LENGTH} characters`,
    );
  }
  if (settings.freeShippingThreshold?.isZero()) {
    throw new InvalidValueError(
      'The free shipping threshold is more than zero, or null',
    );
  }
  for (const days of [
    settings.deliveryMinBusinessDays,
    settings.deliveryMaxBusinessDays,
  ]) {
    if (
      !Number.isInteger(days) ||
      days < 1 ||
      days > MAX_DELIVERY_BUSINESS_DAYS
    ) {
      throw new InvalidValueError(
        `A delivery time is a whole number of business days from 1 to ${MAX_DELIVERY_BUSINESS_DAYS}`,
      );
    }
  }
  if (settings.deliveryMaxBusinessDays < settings.deliveryMinBusinessDays) {
    throw new DeliveryRangeError();
  }
  return { ...settings, name };
}
