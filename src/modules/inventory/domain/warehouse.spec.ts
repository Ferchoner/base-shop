import {
  InvalidStateTransitionError,
  InvalidValueError,
  newId,
  ResourceInUseError,
} from '../../../shared-kernel/index.js';
import {
  InvalidWarehouseLocationError,
  LastActiveWarehouseError,
  MAX_WAREHOUSE_NAME_LENGTH,
  Warehouse,
  type WarehouseAddress,
} from './warehouse.js';

const address: WarehouseAddress = {
  recipientName: 'Ana Ruiz',
  phone: '4431234567',
  street: 'Av. Madero Poniente',
  exteriorNumber: '123',
  interiorNumber: null,
  neighborhood: 'Centro',
  postalCode: '58000',
  stateCode: '16',
  stateName: 'Michoacán de Ocampo',
  municipalityCode: '16053',
  municipalityName: 'Morelia',
  city: 'Morelia',
  references: null,
  country: 'MX',
};

const warehouse = () =>
  Warehouse.restore({
    id: newId(),
    code: 'PRINCIPAL',
    name: 'Almacén principal',
    address: null,
    status: 'ACTIVE',
    priority: 1,
  });

describe('Warehouse (UC-INV-01, ADR-0127)', () => {
  it('changes the name, trimmed, and keeps what is not given', () => {
    const main = warehouse();

    main.describe({ address });
    main.describe({ name: '  Almacén Morelia ' });

    expect(main.snapshot()).toMatchObject({
      name: 'Almacén Morelia',
      address,
    });
  });

  it('takes the address away with null', () => {
    const main = warehouse();
    main.describe({ address });

    main.describe({ address: null });

    expect(main.snapshot().address).toBeNull();
  });

  it.each(['   ', 'a'.repeat(MAX_WAREHOUSE_NAME_LENGTH + 1)])(
    'rejects the name %j',
    (name) => {
      expect(() => warehouse().describe({ name })).toThrow(InvalidValueError);
    },
  );

  it('creates an active warehouse with its code, trimmed name, address and priority (UC-INV-10, ADR-0160)', () => {
    const id = newId<'Warehouse'>();

    const north = Warehouse.create({
      id,
      code: 'NORTE-2',
      name: '  Almacén norte ',
      address,
      priority: 1000,
    });

    expect(north.snapshot()).toEqual({
      id,
      code: 'NORTE-2',
      name: 'Almacén norte',
      address,
      status: 'ACTIVE',
      priority: 1000,
    });
    expect(
      Warehouse.create({
        id,
        code: 'N1',
        name: 'Norte',
        address: null,
        priority: 1,
      }).snapshot(),
    ).toMatchObject({ code: 'N1', priority: 1 });
  });

  it.each([
    ['a code too short', { code: 'N' }],
    ['a code too long', { code: 'N'.repeat(21) }],
    ['a code in small letters', { code: 'norte' }],
    ['a code that starts with a hyphen', { code: '-NORTE' }],
    ['a code with a space', { code: 'NORTE 2' }],
    ['a blank name', { name: '  ' }],
    ['a priority of 0', { priority: 0 }],
    ['a priority above 1000', { priority: 1001 }],
    ['a priority that is not whole', { priority: 1.5 }],
  ])('rejects %s', (_, change) => {
    expect(() =>
      Warehouse.create({
        id: newId<'Warehouse'>(),
        code: 'NORTE',
        name: 'Almacén norte',
        address: null,
        priority: 2,
        ...change,
      }),
    ).toThrow(InvalidValueError);
  });

  it('changes the priority within 1 and 1000 (ADR-0160)', () => {
    const main = warehouse();

    main.prioritize(7);

    expect(main.snapshot().priority).toBe(7);
    for (const priority of [0, 1001, 2.5]) {
      expect(() => main.prioritize(priority)).toThrow(InvalidValueError);
    }
    expect(main.snapshot().priority).toBe(7);
  });

  it('deactivates for good only an active warehouse that is not the last and holds no units for orders (UC-INV-11)', () => {
    const main = warehouse();
    const last = warehouse();
    const holding = warehouse();

    expect(() =>
      last.deactivate({ activeWarehouses: 1, reservedUnits: 0 }),
    ).toThrow(new LastActiveWarehouseError());
    expect(() =>
      holding.deactivate({ activeWarehouses: 2, reservedUnits: 1 }),
    ).toThrow(ResourceInUseError);
    main.deactivate({ activeWarehouses: 2, reservedUnits: 0 });

    expect(main.snapshot().status).toBe('INACTIVE');
    expect([last.isActive, holding.isActive]).toEqual([true, true]);
    expect(() =>
      main.deactivate({ activeWarehouses: 2, reservedUnits: 0 }),
    ).toThrow(InvalidStateTransitionError);
    expect(new LastActiveWarehouseError().details).toEqual({
      currentStatus: 'ACTIVE',
      reason: 'last-active-warehouse',
    });
  });

  it('tells whether it is active', () => {
    const inactive = Warehouse.restore({
      ...warehouse().snapshot(),
      status: 'INACTIVE',
    });

    expect(warehouse().isActive).toBe(true);
    expect(inactive.isActive).toBe(false);
  });

  it.each([
    ['unknown-state', 'address.stateCode', 'isState'],
    [
      'municipality-not-in-state',
      'address.municipalityCode',
      'isMunicipalityOfState',
    ],
    [
      'inactive-municipality',
      'address.municipalityCode',
      'isActiveMunicipality',
    ],
  ] as const)('answers %s on %s', (problem, field, code) => {
    expect(new InvalidWarehouseLocationError(problem).details).toEqual({
      errors: [expect.objectContaining({ field, code })],
    });
  });
});
