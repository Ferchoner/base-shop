import { Money } from '../../../shared-kernel/index.js';
import type { ShippingMethodSettings } from './shipping-method.js';

/** The goods of an order, as the checkout sees them (BR-ORD-16). */
export interface OrderAmounts {
  /** Subtotal of the lines, VAT included. */
  readonly subtotal: Money;
  /** Always zero in the MVP (ADR-0018). */
  readonly discount: Money;
}

/** What an order pays for shipping, and the VAT it contains (ADR-0079). */
export interface ShippingCharge {
  /** VAT included; zero when shipping is free. */
  readonly cost: Money;
  /** VAT contained in `cost`, rounded like a line (ADR-0008); zero when shipping is free. */
  readonly taxAmount: Money;
  /** The rate applied, in basis points, for the order's snapshot. */
  readonly taxRateBp: number;
}

/**
 * The shipping cost of an order (UC-SHI-01, BR-SHP-06, BR-SHP-12, ADR-0042, ADR-0079): the flat fee, VAT
 * included, or nothing when the subtotal with VAT minus the discount reaches the free shipping threshold.
 * The shipping cost itself never counts toward the threshold.
 */
export class ShippingRateCalculator {
  /** @param taxRateBp the configured VAT rate (`VAT_RATE_BP`, ADR-0027). */
  constructor(private readonly taxRateBp: number) {}

  charge(method: ShippingMethodSettings, order: OrderAmounts): ShippingCharge {
    const cost = this.isFree(method, order)
      ? Money.zero(method.flatFee.currency)
      : method.flatFee;
    return {
      cost,
      taxAmount: cost.containedTax(this.taxRateBp),
      taxRateBp: this.taxRateBp,
    };
  }

  private isFree(method: ShippingMethodSettings, order: OrderAmounts): boolean {
    const threshold = method.freeShippingThreshold;
    return (
      threshold !== null &&
      order.subtotal.subtract(order.discount).greaterThanOrEqual(threshold)
    );
  }
}
