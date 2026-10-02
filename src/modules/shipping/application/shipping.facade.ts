import { Inject, Injectable } from '@nestjs/common';
import {
  Clock,
  type Money,
  newId,
  toId,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import {
  type OrderId,
  type OrderLineId,
  Shipment,
  type ShipmentAddress,
  type WarehouseId,
} from '../domain/shipment.js';
import { ShipmentRepository } from '../domain/shipment.repository.js';
import type { ShippingMethodId } from '../domain/shipping-method.js';
import { ShippingMethodRepository } from '../domain/shipping-method.repository.js';
import {
  type OrderAmounts,
  ShippingRateCalculator,
} from '../domain/shipping-rate-calculator.js';
import { type OrderShipmentView, ShippingQueries } from './shipping.queries.js';
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

/** What Ordering hands over to create the shipment of an order just paid (UC-SHI-03, ADR-0140). */
export interface NewShipment {
  readonly orderId: OrderId;
  /** The public code of the order, without dash. */
  readonly orderCode: string;
  readonly warehouseId: WarehouseId;
  readonly destination: ShipmentAddress;
  readonly items: readonly {
    readonly orderLineId: OrderLineId;
    readonly sku: string;
    readonly productName: string;
    readonly quantity: number;
  }[];
}

/**
 * Public API of Shipping for Ordering (ADR-0005): the shipping of a checkout (T-180) and the shipment of a paid
 * order (T-195, ADR-0140). It reads the active method on every call, never from a cache, because an order must
 * apply the current values (ADR-0028). The operations on shipments join the transaction of their caller.
 */
@Injectable()
export class ShippingFacade {
  private readonly calculator: ShippingRateCalculator;

  constructor(
    private readonly methods: ShippingMethodRepository,
    private readonly shipments: ShipmentRepository,
    private readonly queries: ShippingQueries,
    private readonly transactions: TransactionManager,
    private readonly clock: Clock,
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

  /**
   * Creates the shipment of an order just paid, PENDING (UC-SHI-03, BR-SHP-01, BR-SHP-02), in the transaction
   * that marks the order paid (ADR-0140). An order that already has one keeps it.
   *
   * @throws InvalidValueError without items.
   */
  createShipment(input: NewShipment): Promise<void> {
    return this.transactions.run(async () => {
      const shipment = Shipment.create({ id: newId<'Shipment'>(), ...input });
      await this.shipments.insert(shipment, this.clock.now());
    });
  }

  /**
   * Cancels the shipment of an order cancelled before it left (UC-ORD-07, ADR-0140); nothing when the order has
   * none.
   *
   * @throws InvalidStateTransitionError when the shipment is no longer PENDING.
   */
  cancelShipmentOf(orderId: OrderId): Promise<void> {
    return this.transactions.run(async () => {
      const shipment = await this.shipments.lockByOrder(orderId);
      if (shipment === null) return;
      const now = this.clock.now();
      shipment.cancel(now);
      await this.shipments.save(shipment, now);
    });
  }

  /** The shipments of these orders, by order; an order without one is left out. */
  shipmentsOf(
    orderIds: readonly string[],
  ): Promise<ReadonlyMap<OrderId, OrderShipmentView>> {
    return this.queries.shipmentsOf(orderIds.map((id) => toId<'Order'>(id)));
  }
}
