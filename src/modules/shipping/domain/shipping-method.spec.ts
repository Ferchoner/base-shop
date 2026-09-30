import {
  InvalidValueError,
  Money,
  newId,
} from '../../../shared-kernel/index.js';
import {
  DeliveryRangeError,
  MAX_DELIVERY_BUSINESS_DAYS,
  ShippingMethod,
  type ShippingMethodSettings,
} from './shipping-method.js';

const mxn = (amount: number) => Money.of(amount, 'MXN');

/** The provisional values of ADR-0092. */
const STANDARD: ShippingMethodSettings = {
  name: 'Envío Estándar',
  flatFee: mxn(9_900),
  freeShippingThreshold: mxn(150_000),
  deliveryMinBusinessDays: 3,
  deliveryMaxBusinessDays: 7,
};

const method = () =>
  ShippingMethod.restore({
    ...STANDARD,
    id: newId(),
    isActive: true,
    version: 4,
  });

const configured = (changes: Partial<ShippingMethodSettings>) => {
  const shipping = method();
  shipping.configure({ ...STANDARD, ...changes });
  return shipping.snapshot();
};

describe('ShippingMethod (UC-SHI-02, ADR-0042, ADR-0079, ADR-0083)', () => {
  it('replaces every setting, with a trimmed name, and keeps its identity and version', () => {
    const shipping = method();
    const { id } = shipping.snapshot();

    shipping.configure({
      name: '  Envío Nacional  ',
      flatFee: mxn(12_900),
      freeShippingThreshold: mxn(99_900),
      deliveryMinBusinessDays: 2,
      deliveryMaxBusinessDays: 5,
    });

    expect(shipping.snapshot()).toEqual({
      id,
      name: 'Envío Nacional',
      flatFee: mxn(12_900),
      freeShippingThreshold: mxn(99_900),
      deliveryMinBusinessDays: 2,
      deliveryMaxBusinessDays: 5,
      isActive: true,
      version: 4,
    });
  });

  it('accepts no free shipping, a flat fee of zero and a single-day range', () => {
    expect(configured({ freeShippingThreshold: null })).toMatchObject({
      freeShippingThreshold: null,
    });
    expect(configured({ flatFee: mxn(0) }).flatFee).toEqual(mxn(0));
    expect(
      configured({ deliveryMinBusinessDays: 1, deliveryMaxBusinessDays: 1 }),
    ).toMatchObject({ deliveryMinBusinessDays: 1, deliveryMaxBusinessDays: 1 });
    expect(
      configured({
        deliveryMinBusinessDays: MAX_DELIVERY_BUSINESS_DAYS,
        deliveryMaxBusinessDays: MAX_DELIVERY_BUSINESS_DAYS,
      }).deliveryMaxBusinessDays,
    ).toBe(MAX_DELIVERY_BUSINESS_DAYS);
  });

  it.each(['', '   ', 'a'.repeat(101)])('rejects the name %p', (name) => {
    expect(() => configured({ name })).toThrow(InvalidValueError);
  });

  it('rejects a free shipping threshold of zero: null is how to turn it off', () => {
    expect(() => configured({ freeShippingThreshold: mxn(0) })).toThrow(
      InvalidValueError,
    );
  });

  it.each([
    { deliveryMinBusinessDays: 0 },
    { deliveryMaxBusinessDays: 0 },
    { deliveryMinBusinessDays: 1.5 },
    { deliveryMaxBusinessDays: MAX_DELIVERY_BUSINESS_DAYS + 1 },
    { deliveryMinBusinessDays: MAX_DELIVERY_BUSINESS_DAYS + 1 },
  ])('rejects the delivery time %j', (days) => {
    expect(() => configured(days)).toThrow(InvalidValueError);
  });

  it('rejects a range whose maximum is below its minimum, on deliveryMaxBusinessDays', () => {
    expect(() =>
      configured({ deliveryMinBusinessDays: 5, deliveryMaxBusinessDays: 4 }),
    ).toThrow(DeliveryRangeError);
    expect(new DeliveryRangeError().details).toEqual({
      errors: [
        expect.objectContaining({
          field: 'deliveryMaxBusinessDays',
          code: 'deliveryRange',
        }),
      ],
    });
  });

  it('leaves the method as it was when a setting is invalid', () => {
    const shipping = method();

    expect(() =>
      shipping.configure({
        ...STANDARD,
        name: 'Otro',
        flatFee: mxn(1),
        deliveryMinBusinessDays: 0,
      }),
    ).toThrow(InvalidValueError);
    expect(shipping.snapshot()).toMatchObject(STANDARD);
  });

  it('takes the version the repository saved', () => {
    const shipping = method();

    shipping.markSaved(5);

    expect(shipping.version).toBe(5);
  });
});
