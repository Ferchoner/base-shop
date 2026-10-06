import { InvalidValueError, newId } from '../../../shared-kernel/index.js';
import {
  InvalidWarehouseLocationError,
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
