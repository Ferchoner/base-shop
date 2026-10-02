import {
  type Clock,
  Money,
  newId,
  type TransactionManager,
} from '../../../shared-kernel/index.js';
import type { ShipmentRepository } from '../domain/shipment.repository.js';
import { ShippingMethod } from '../domain/shipping-method.js';
import { ShippingMethodRepository } from '../domain/shipping-method.repository.js';
import { ShippingFacade } from './shipping.facade.js';
import type { ShippingQueries } from './shipping.queries.js';

const mxn = (amount: number) => Money.of(amount, 'MXN');

/** A repository with the given active method, or none. */
class FixedMethod extends ShippingMethodRepository {
  constructor(private readonly method: ShippingMethod | null) {
    super();
  }

  findActive(): Promise<ShippingMethod | null> {
    return Promise.resolve(this.method);
  }

  save(): Promise<void> {
    return Promise.reject(new Error('not used'));
  }
}

/** A facade that only quotes: its shipments are never touched. */
const quoting = (method: ShippingMethod | null) =>
  new ShippingFacade(
    new FixedMethod(method),
    {} as ShipmentRepository,
    {} as ShippingQueries,
    {} as TransactionManager,
    {} as Clock,
    1_600,
  );

describe('ShippingFacade (UC-SHI-01, ADR-0122)', () => {
  const id = newId<'ShippingMethod'>();
  const standard = ShippingMethod.restore({
    id,
    name: 'Envío Estándar',
    flatFee: mxn(9_900),
    freeShippingThreshold: mxn(150_000),
    deliveryMinBusinessDays: 3,
    deliveryMaxBusinessDays: 7,
    isActive: true,
    version: 1,
  });

  it('quotes the shipping of an order with the active method and the configured VAT rate', async () => {
    const facade = quoting(standard);

    expect(
      await facade.quote({ subtotal: mxn(119_800), discount: mxn(0) }),
    ).toEqual({
      methodId: id,
      cost: mxn(9_900),
      taxAmount: mxn(1_366),
      taxRateBp: 1_600,
      freeShippingThreshold: mxn(150_000),
      deliveryMinBusinessDays: 3,
      deliveryMaxBusinessDays: 7,
    });
  });

  it('still shows the threshold and the delivery time when shipping is free', async () => {
    const facade = quoting(standard);

    expect(
      await facade.quote({ subtotal: mxn(150_000), discount: mxn(0) }),
    ).toMatchObject({
      cost: mxn(0),
      taxAmount: mxn(0),
      freeShippingThreshold: mxn(150_000),
      deliveryMinBusinessDays: 3,
    });
  });

  it('fails loudly without an active method, which the migration always creates', async () => {
    const facade = quoting(null);

    await expect(
      facade.quote({ subtotal: mxn(100), discount: mxn(0) }),
    ).rejects.toThrow('There is no active shipping method');
  });
});
