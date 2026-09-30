import { Inject, Injectable } from '@nestjs/common';
import type { Money } from '../../../shared-kernel/index.js';
import type { ShippingMethodId } from '../domain/shipping-method.js';
import { ShippingMethodRepository } from '../domain/shipping-method.repository.js';
import {
  type OrderAmounts,
  ShippingRateCalculator,
} from '../domain/shipping-rate-calculator.js';
import { VAT_RATE_BP } from './vat-rate.js';

/** Shipping of an order, as the checkout shows it and the order keeps it (API_SPEC.md §8.7, BR-SHP-07). */
export interface ShippingQuote {
  readonly methodId: ShippingMethodId;
  /** VAT included; zero when shipping is free (ADR-0079). */
  readonly cost: Money;
  readonly taxAmount: Money;
  readonly taxRateBp: number;
  /** Shown to the customer; `null` when there is no free shipping (ADR-0092). */
  readonly freeShippingThreshold: Money | null;
  /** Estimated delivery time in business days after payment (ADR-0083). */
  readonly deliveryMinBusinessDays: number;
  readonly deliveryMaxBusinessDays: number;
}

/**
 * Public API of Shipping for the checkout of Ordering (ADR-0005, T-180). It reads the active method on every
 * call, never from a cache, because an order must apply the current values (ADR-0028).
 */
@Injectable()
export class ShippingFacade {
  private readonly calculator: ShippingRateCalculator;

  constructor(
    private readonly methods: ShippingMethodRepository,
    @Inject(VAT_RATE_BP) taxRateBp: number,
  ) {
    this.calculator = new ShippingRateCalculator(taxRateBp);
  }

  /** The shipping of an order with these amounts (UC-SHI-01). */
  async quote(order: OrderAmounts): Promise<ShippingQuote> {
    const method = await this.methods.findActive();
    // A migration creates the method (ADR-0092, ADR-0122), and nothing deactivates it in the MVP.
    if (method === null) throw new Error('There is no active shipping method');
    const settings = method.snapshot();
    return {
      methodId: settings.id,
      ...this.calculator.charge(settings, order),
      freeShippingThreshold: settings.freeShippingThreshold,
      deliveryMinBusinessDays: settings.deliveryMinBusinessDays,
      deliveryMaxBusinessDays: settings.deliveryMaxBusinessDays,
    };
  }
}
